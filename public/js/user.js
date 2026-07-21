// ==================== 用户面板 JS ====================

const token = localStorage.getItem('token');
const username = localStorage.getItem('username');

if (!token) {
  window.location.href = '/';
}

document.getElementById('usernameDisplay').textContent = username;

// ==================== 工具函数 ====================

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast toast-${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function logout() {
  localStorage.clear();
  window.location.href = '/';
}

function getStatusBadge(status) {
  const map = {
    pending: '<span class="status-badge status-pending">待处理</span>',
    success: '<span class="status-badge status-success">成功</span>',
    failure: '<span class="status-badge status-failure">失败</span>'
  };
  return map[status] || map.pending;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ==================== 图片灯箱 ====================

function openLightbox(imgSrc, info) {
  document.getElementById('lightboxImg').src = imgSrc;
  document.getElementById('lightboxInfo').innerHTML = info ? `<b>${info}</b>` : '';
  document.getElementById('lightbox').classList.add('active');
}

function closeLightbox(e) {
  if (e && e.target.id !== 'lightbox') return;
  document.getElementById('lightbox').classList.remove('active');
  document.getElementById('lightboxImg').src = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// ==================== 提交物流信息 ====================

document.getElementById('submitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = document.getElementById('phone').value.trim();
  const logistics_number = document.getElementById('logisticsNumber').value.trim();
  const quantity = document.getElementById('quantity').value.trim();

  try {
    const resp = await fetch('/api/submissions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ phone, logistics_number, quantity })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '提交失败');

    showToast('提交成功');
    document.getElementById('submitForm').reset();
    loadSubmissions();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==================== 加载我的提交记录 ====================

async function loadSubmissions() {
  try {
    const resp = await fetch('/api/submissions', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (resp.status === 401) { logout(); return; }
    const data = await resp.json();
    renderSubmissions(data);
  } catch (err) {
    showToast('加载失败', 'error');
  }
}

function renderSubmissions(submissions) {
  const container = document.getElementById('submissionsList');

  if (!submissions || submissions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <p>暂无提交记录</p>
      </div>`;
    return;
  }

  container.innerHTML = submissions.map(s => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <div>
          <div style="font-size:16px;font-weight:700;color:#1f2937;">物流单号：${s.logistics_number}</div>
          <div style="font-size:13px;color:#9ca3af;margin-top:4px;">提交时间：${formatDate(s.created_at)}</div>
        </div>
        ${getStatusBadge(s.admin_status)}
      </div>

      <div class="info-grid">
        <div class="info-item">
          <div class="label">手机号码</div>
          <div class="value">${s.phone}</div>
        </div>
        <div class="info-item">
          <div class="label">商品数量</div>
          <div class="value">${s.quantity}</div>
        </div>
      </div>

      ${s.extra_fields && s.extra_fields.length > 0 ? `
        <div class="section-label">管理员补充信息</div>
        <div class="info-grid">
          ${s.extra_fields.map(f => `
            <div class="info-item">
              <div class="label">${f.key}</div>
              <div class="value">${f.value}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${s.scan_reference_image || s.logistics_image ? `
        <div class="section-label">🖼 物流图片</div>
        <img src="${s.scan_reference_image || s.logistics_image}" class="image-preview" style="margin-bottom:16px;cursor:zoom-in;" onclick="openLightbox(this.src, '物流图片 - 运单号 ${s.logistics_number}')" alt="物流图片">

        <div class="section-label">📝 签收确认 <span style="font-weight:400;color:#9ca3af;font-size:12px;">（输入您与商家约定的 6 位数字）</span></div>
        ${s.user_code ? `
          <div class="info-item" style="background:#eef2ff;">
            <div class="label">已提交签收码</div>
            <div class="value" style="font-size:20px;letter-spacing:4px;color:#4f46e5;">${s.user_code}</div>
          </div>
        ` : `
          <div class="code-input-group">
            <input type="text" id="code_${s.id}" maxlength="6" placeholder="请输入6位数字" pattern="\\d{6}" inputmode="numeric"
                   style="padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:16px;letter-spacing:4px;text-align:center;width:160px;">
            <button class="btn btn-primary" onclick="submitCode(${s.id})">提交签收码</button>
          </div>
        `}
      ` : `
        <div class="alert alert-warning">⏳ 管理员暂未提供图片，请耐心等待</div>
      `}

      ${s.admin_status !== 'pending' ? `
        <div class="alert ${s.admin_status === 'success' ? 'alert-success' : 'alert-error'}">
          管理员审核结果：<strong>${s.admin_status === 'success' ? '成功' : '失败'}</strong>
          ${s.admin_remark ? `<br>备注：${s.admin_remark}` : ''}
        </div>
      ` : ''}
    </div>
  `).join('');
}

// ==================== 提交验证码 ====================

async function submitCode(id) {
  const code = document.getElementById(`code_${id}`).value.trim();
  if (!/^\d{6}$/.test(code)) {
    showToast('请输入6位数字', 'error');
    return;
  }

  try {
    const resp = await fetch(`/api/submissions/${id}/code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ code })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '提交失败');

    showToast('签收码提交成功');
    loadSubmissions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== 初始化 ====================

loadSubmissions();
