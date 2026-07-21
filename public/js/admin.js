// ==================== 管理面板 JS ====================

const token = localStorage.getItem('token');
const role = localStorage.getItem('role');
const username = localStorage.getItem('username');

if (!token || role !== 'admin') {
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

function closeModal() {
  if (currentSubmission) delete currentSubmission._editingLogistics;
  document.getElementById('detailModal').classList.remove('active');
}

// ==================== 加载提交列表 ====================

async function loadSubmissions() {
  const search = document.getElementById('searchInput').value.trim();
  const url = search ? `/api/admin/submissions?search=${encodeURIComponent(search)}` : '/api/admin/submissions';

  try {
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (resp.status === 401) { logout(); return; }
    const data = await resp.json();
    renderTable(data);
  } catch (err) {
    showToast('加载失败', 'error');
  }
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  loadSubmissions();
}

// 导出提交记录为 CSV（按当前搜索框过滤；空 = 全部）
async function exportSubmissionsCSV() {
  const search = document.getElementById('searchInput').value.trim();
  const url = search
    ? `/api/admin/submissions?search=${encodeURIComponent(search)}`
    : '/api/admin/submissions';

  const btn = event && event.target ? event.target : null;
  const oldText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 导出中...'; }

  try {
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (resp.status === 401) { logout(); return; }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      showToast('导出失败：' + (err.error || resp.statusText), 'error');
      return;
    }
    const data = await resp.json();
    if (!data || data.length === 0) {
      showToast('没有可导出的数据', 'error');
      return;
    }

    const STATUS_MAP = { pending: '待处理', success: '成功', failure: '失败' };
    const header = ['ID', '提交用户', '手机号', '物流单号', '商品数量',
                    // '物流图片',   // 2026-07-21 用户要求不需要此列
                    '顺丰图片', '用户验证码', '审核状态',
                    '提交时间', '更新时间'];
    const rows = [header];
    data.forEach(s => {
      rows.push([
        s.id,
        s.username || '',
        s.phone || '',
        s.logistics_number || '',
        s.quantity != null ? s.quantity : '',
        // s.logistics_image ? '已上传' : '未上传',   // 2026-07-21 用户要求不需要此列
        s.scan_reference_image ? '已上传' : '未上传',
        s.user_code || '',
        STATUS_MAP[s.admin_status] || (s.admin_status || '待处理'),
        s.created_at || '',
        s.updated_at || ''
      ]);
    });

    // CSV：加 UTF-8 BOM 防止 Excel 打开乱码；字段加引号、引号转义
    const csv = '\ufeff' + rows.map(r =>
      r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    a.href = dlUrl;
    a.download = search
      ? `提交记录_搜索_${search}_${ts}.csv`
      : `提交记录_全部_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(dlUrl);
    showToast(`已导出 ${data.length} 条记录`, 'success');
  } catch (err) {
    showToast('导出失败：' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = oldText || '📥 导出CSV'; }
  }
}

function renderTable(submissions) {
  const tbody = document.getElementById('submissionsTableBody');
  const emptyState = document.getElementById('emptyState');

  if (!submissions || submissions.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  tbody.innerHTML = submissions.map(s => `
    <tr>
      <td>#${s.id}</td>
      <td>${s.username}</td>
      <td>${s.phone}</td>
      <td style="font-weight:600;">${s.logistics_number}</td>
      <td>${s.quantity}</td>
      <td>
        ${s.scan_reference_image
          ? `<img src="${s.scan_reference_image}" class="scan-thumb" data-label="顺丰图片 - 提交 #${s.id} 运单号 ${s.logistics_number || '无'}" onclick="openLightbox(this.src, this.dataset.label)" alt="顺丰图片">`
          : '<span style="color:#9ca3af;">未上传</span>'}
      </td>
      <!-- 物流图片列已隐藏（2026-07-21 用户要求不需要此列） -->
      <!-- <td>${s.logistics_image ? '<span style="color:#10b981;">已上传</span>' : '<span style="color:#9ca3af;">未上传</span>'}</td> -->
      <td>${s.user_code ? `<span style="font-weight:700;letter-spacing:2px;color:#4f46e5;">${s.user_code}</span>` : '<span style="color:#9ca3af;">未提交</span>'}</td>
      <td>${getStatusBadge(s.admin_status)}</td>
      <td style="font-size:13px;color:#6b7280;">${formatDate(s.created_at)}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="openDetail(${s.id})">详情</button>
      </td>
    </tr>
  `).join('');
}

// ==================== 查看详情 ====================

let currentSubmission = null;

async function openDetail(id) {
  try {
    const resp = await fetch(`/api/admin/submissions/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '加载失败');

    currentSubmission = data;
    renderDetail(data);
    document.getElementById('detailModal').classList.add('active');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderDetail(s) {
  const body = document.getElementById('detailBody');
  const footer = document.getElementById('modalFooter');

  // 物流单号：默认只读 + 修改按钮；编辑模式下变输入框
  const isEditing = currentSubmission && currentSubmission._editingLogistics;
  const logisticsHtml = isEditing
    ? `<div style="display:flex;gap:6px;align-items:center;">
         <input type="text" id="logisticsInput" value="${s.logistics_number || ''}"
           style="flex:1;padding:6px 8px;border:1px solid #4f46e5;border-radius:6px;font-size:14px;">
         <button class="btn btn-success btn-sm" onclick="saveLogisticsNumber(${s.id})">保存</button>
         <button class="btn btn-outline btn-sm" onclick="cancelEditLogistics()">取消</button>
       </div>`
    : `<div style="display:flex;gap:8px;align-items:center;">
         <span class="value" style="font-weight:600;">${s.logistics_number || '-'}</span>
         <button class="btn btn-outline btn-sm" onclick="startEditLogistics()">修改</button>
       </div>`;

  body.innerHTML = `
    <div class="info-grid">
      <div class="info-item">
        <div class="label">提交用户</div>
        <div class="value">${s.username}</div>
      </div>
      <div class="info-item">
        <div class="label">提交时间</div>
        <div class="value" style="font-size:14px;">${formatDate(s.created_at)}</div>
      </div>
      <div class="info-item">
        <div class="label">手机号码</div>
        <div class="value">${s.phone}</div>
      </div>
      <div class="info-item">
        <div class="label">物流单号</div>
        ${logisticsHtml}
      </div>
      <div class="info-item">
        <div class="label">商品数量</div>
        <div class="value">${s.quantity}</div>
      </div>
      <div class="info-item">
        <div class="label">审核状态</div>
        <div class="value">${getStatusBadge(s.admin_status)}</div>
      </div>
    </div>

    <!-- 物流图片 区块已隐藏（2026-07-21 用户要求暂时不显示）
    <div class="section-label">物流图片 <span style="font-weight:400;color:#9ca3af;font-size:12px;">（管理员上传给用户看的图）</span></div>
    ${s.logistics_image
      ? `<img src="${s.logistics_image}" class="image-preview" style="margin-bottom:12px;cursor:zoom-in;" alt="物流图片" onclick="openLightbox(this.src, '物流图片 - 提交 #${s.id}')">`
      : `<div class="image-placeholder">暂无图片</div>`
    }
    <div class="upload-area" onclick="document.getElementById('imageInput').click()" style="margin-top:12px;">
      <div class="upload-icon">📷</div>
      <p>点击上传物流图片（支持 JPG/PNG/GIF 等）</p>
    </div>
    <input type="file" id="imageInput" accept="image/*" style="display:none;" onchange="uploadImage(${s.id})">
    -->

    <!-- 顺丰图片（批量识别时自动关联） -->
    <div class="section-label">顺丰图片 <span style="font-weight:400;color:#9ca3af;font-size:12px;">（批量识别运单时上传的图，自动按运单号关联）</span></div>
    ${s.scan_reference_image
      ? `<img src="${s.scan_reference_image}" class="image-preview" style="margin-bottom:12px;cursor:zoom-in;" alt="顺丰图片" data-label="顺丰图片 #${s.id} 运单号 ${s.logistics_number || '无'}" onclick="openLightbox(this.src, this.dataset.label)">`
      : `<div class="image-placeholder">暂无顺丰图片（去「批量识别运单」上传图片即可自动关联）</div>`
    }

    <!-- 用户验证码 -->
    <div class="section-label">用户验证码</div>
    ${s.user_code
      ? `<div class="info-item" style="background:#eef2ff;">
          <div class="label">用户提交的6位验证码</div>
          <div class="value" style="font-size:24px;letter-spacing:6px;color:#4f46e5;text-align:center;padding:8px 0;">${s.user_code}</div>
        </div>`
      : `<div class="alert alert-warning">用户尚未提交验证码</div>`
    }

    <!-- 管理员审核 -->
    <div class="section-label">审核操作</div>
    ${s.admin_status !== 'pending' ? `
      <div class="alert ${s.admin_status === 'success' ? 'alert-success' : 'alert-error'}">
        当前审核结果：<strong>${s.admin_status === 'success' ? '成功' : '失败'}</strong>
        ${s.admin_remark ? `<br>备注：${s.admin_remark}` : ''}
      </div>
    ` : ''}
    <div class="form-group" style="margin-top:12px;">
      <label>审核备注</label>
      <input type="text" id="remarkInput" placeholder="输入审核备注（可选）" value="${s.admin_remark || ''}">
    </div>
  `;

  footer.innerHTML = `
    <button class="btn btn-outline" onclick="closeModal()">关闭</button>
    <button class="btn btn-primary" onclick="saveRemark(${s.id})">保存</button>
    <button class="btn btn-success" onclick="setStatus(${s.id}, 'success')">标记成功</button>
    <button class="btn btn-danger" onclick="setStatus(${s.id}, 'failure')">标记失败</button>
  `;
}

// ==================== 修改物流单号 ====================

function startEditLogistics() {
  if (!currentSubmission) return;
  currentSubmission._editingLogistics = true;
  renderDetail(currentSubmission);
  // 自动聚焦
  setTimeout(() => {
    const inp = document.getElementById('logisticsInput');
    if (inp) { inp.focus(); inp.select(); }
  }, 0);
}

function cancelEditLogistics() {
  if (!currentSubmission) return;
  delete currentSubmission._editingLogistics;
  renderDetail(currentSubmission);
}

async function saveLogisticsNumber(id) {
  const inp = document.getElementById('logisticsInput');
  if (!inp) return;
  const val = inp.value.trim();
  if (!val) {
    showToast('物流单号不能为空', 'error');
    return;
  }
  try {
    const resp = await fetch(`/api/admin/submissions/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ logistics_number: val })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '保存失败');

    delete data._editingLogistics;
    currentSubmission = data;
    showToast('物流单号已更新');
    renderDetail(data);
    loadSubmissions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== 额外字段管理 ====================

let extraFields = [];

function renderExtraFields(fields) {
  extraFields = [...fields];
  const container = document.getElementById('extraFieldsContainer');

  if (extraFields.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;padding:8px 0;">暂无补充字段，点击上方按钮添加</p>';
    return;
  }

  container.innerHTML = extraFields.map((f, i) => `
    <div class="field-row">
      <input type="text" placeholder="字段名称" value="${f.key}" oninput="updateField(${i}, 'key', this.value)">
      <input type="text" placeholder="字段值" value="${f.value}" oninput="updateField(${i}, 'value', this.value)">
      <button class="remove-btn" onclick="removeField(${i})">&times;</button>
    </div>
  `).join('');
}

function addField() {
  extraFields.push({ key: '', value: '' });
  renderExtraFields(extraFields);
}

function updateField(index, prop, value) {
  if (extraFields[index]) {
    extraFields[index][prop] = value;
  }
}

function removeField(index) {
  extraFields.splice(index, 1);
  renderExtraFields(extraFields);
}

async function saveExtraFields(id) {
  // 过滤空字段
  const validFields = extraFields.filter(f => f.key.trim() && f.value.trim());

  try {
    const resp = await fetch(`/api/admin/submissions/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ extra_fields: validFields })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '保存失败');

    currentSubmission = data;
    showToast('补充字段保存成功');
    loadSubmissions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== 上传物流图片 ====================

async function uploadImage(id) {
  const fileInput = document.getElementById('imageInput');
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('image', file);

  try {
    const resp = await fetch(`/api/admin/submissions/${id}/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '上传失败');

    currentSubmission = data;
    showToast('图片上传成功');
    renderDetail(data);
    loadSubmissions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== 保存审核备注 ====================

async function saveRemark(id) {
  const remark = document.getElementById('remarkInput')?.value || '';

  try {
    const resp = await fetch(`/api/admin/submissions/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ admin_remark: remark })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '保存失败');

    currentSubmission = data;
    showToast('备注已保存');
    loadSubmissions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== 设置审核状态 ====================

async function setStatus(id, status) {
  const remark = document.getElementById('remarkInput')?.value || '';

  try {
    const resp = await fetch(`/api/admin/submissions/${id}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status, remark })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '操作失败');

    currentSubmission = data;
    showToast(status === 'success' ? '已标记为成功' : '已标记为失败');
    renderDetail(data);
    loadSubmissions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== 搜索回车支持 ====================

document.getElementById('searchInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') loadSubmissions();
});

// ==================== Tab 切换 ====================

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  if (name === 'records') {
    document.getElementById('tabRecords').classList.add('active');
    document.getElementById('content-records').classList.add('active');
  } else if (name === 'scan') {
    document.getElementById('tabScan').classList.add('active');
    document.getElementById('content-scan').classList.add('active');
  }
}

// ==================== 批量识别运单 ====================

let scanResults = []; // { idx, code, success, method, image (dataURL), fileName, candidates }

// 拖拽支持
const scanUploadArea = document.getElementById('scanUploadArea');
scanUploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  scanUploadArea.classList.add('dragover');
});
scanUploadArea.addEventListener('dragleave', () => scanUploadArea.classList.remove('dragover'));
scanUploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  scanUploadArea.classList.remove('dragover');
  handleScanFiles(e.dataTransfer.files);
});

// 处理上传文件
async function handleScanFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (files.length === 0) {
    showToast('请上传图片文件', 'error');
    return;
  }

  document.getElementById('scanEmptyState').style.display = 'none';
  document.getElementById('scanProgress').style.display = 'block';
  document.getElementById('scanResultCard').style.display = 'block';
  document.getElementById('scanToolbar').style.display = 'flex';

  const startIdx = scanResults.length + 1;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const idx = startIdx + i;
    updateScanProgress(idx, files.length, file.name);

    // 先占位渲染一行
    scanResults.push({
      idx, code: '', success: false, method: '', image: '',
      fileName: file.name, loading: true
    });
    renderScanTable();

    try {
      // 转 base64
      const dataUrl = await fileToDataURL(file);
      // 调后端 OCR 识别
      const resp = await fetch('/api/scan-barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl })
      });
      const data = await resp.json();
      const r = data.results && data.results[0];
      if (r && r.success && r.code) {
        scanResults[scanResults.length - 1] = {
          idx, code: r.code, success: true, method: r.method || 'ocr',
          image: dataUrl, fileName: file.name, candidates: r.candidates || [],
          loading: false
        };
      } else {
        scanResults[scanResults.length - 1] = {
          idx, code: '', success: false, method: '', image: dataUrl,
          fileName: file.name, loading: false
        };
      }
    } catch (err) {
      scanResults[scanResults.length - 1] = {
        idx, code: '', success: false, method: '', image: '',
        fileName: file.name, loading: false, error: err.message
      };
    }
    renderScanTable();
  }

  // 完成
  document.getElementById('scanProgress').style.display = 'none';
  updateScanStats();
  showToast(`识别完成：${scanResults.filter(r => r.success).length}/${scanResults.length} 张成功`);
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function updateScanProgress(idx, total, fileName) {
  const pct = Math.round((idx / total) * 100);
  document.getElementById('scanProgressText').textContent =
    `正在识别 ${idx}/${total}：${fileName}`;
  document.getElementById('scanProgressFill').style.width = pct + '%';
}

function renderScanTable() {
  const tbody = document.getElementById('scanTableBody');
  if (scanResults.length === 0) {
    tbody.innerHTML = '';
    return;
  }
  tbody.innerHTML = scanResults.map(r => `
    <tr>
      <td>${r.idx}</td>
      <td>
        <div id="scanCodeBox_${r.idx}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="scan-code" style="${r.success ? '' : 'color:#9ca3af;'}">${r.code || '未识别'}</span>
          <button class="btn-icon-edit" title="修改运单号" onclick="startEditScanCode(${r.idx})">✏️</button>
        </div>
        ${r.candidates && r.candidates.length > 1
          ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">候选：${r.candidates.slice(1).map(c => `<a href="javascript:void(0)" onclick="quickSetScanCode(${r.idx},'${c.replace(/'/g, "\\'")}')" style="color:#6b7280;text-decoration:underline;margin-right:6px;">${c}</a>`).join('')}</div>`
          : ''}
      </td>
      <td>
        ${r.image
          ? `<img src="${r.image}" class="scan-thumb" onclick="openLightbox('${r.image}', '${r.code || r.fileName}')" alt="${r.fileName}">`
          : '<span style="color:#9ca3af;">-</span>'}
      </td>
      <td>${r.method ? `<span style="color:#6b7280;">${r.method.toUpperCase()}</span>` : '-'}</td>
      <td>
        ${r.success
          ? `<button class="btn btn-outline btn-sm" onclick="searchByCode('${r.code}')">查记录</button>
             <button class="btn btn-primary btn-sm" onclick="openAttachModal('${r.code.replace(/'/g, "\\'")}', '${r.idx}')">关联</button>`
          : ''}
        ${r.image
          ? `<button class="btn btn-outline btn-sm" onclick="openLightbox('${r.image}', '${r.code || r.fileName}')">查看</button>`
          : ''}
      </td>
    </tr>
  `).join('');
}

// 一键从候选里选一个运单号
function quickSetScanCode(idx, code) {
  const r = scanResults.find(x => x.idx === idx);
  if (!r) return;
  r.code = code;
  r.success = /SF\d{12,13}/.test(code);
  renderScanTable();
  showToast(`已设为 ${code}`, 'success');
}

// 进入编辑模式：运单号变成 input + 保存/取消
function startEditScanCode(idx) {
  const box = document.getElementById(`scanCodeBox_${idx}`);
  const r = scanResults.find(x => x.idx === idx);
  if (!box || !r) return;
  box.dataset.originalCode = r.code;
  box.innerHTML = `
    <input type="text" id="scanCodeInput_${idx}" value="${r.code || ''}" placeholder="SF + 12-13位数字"
           style="padding:4px 8px;border:1px solid #4f46e5;border-radius:4px;font-size:14px;width:160px;font-family:monospace;"
           onkeydown="if(event.key==='Enter'){saveEditScanCode(${idx});}else if(event.key==='Escape'){cancelEditScanCode(${idx});}">
    <button class="btn btn-primary btn-sm" onclick="saveEditScanCode(${idx})" title="保存(Enter)">✓</button>
    <button class="btn btn-outline btn-sm" onclick="cancelEditScanCode(${idx})" title="取消(Esc)">✗</button>
  `;
  const input = document.getElementById(`scanCodeInput_${idx}`);
  input.focus(); input.select();
}

// 保存编辑
function saveEditScanCode(idx) {
  const input = document.getElementById(`scanCodeInput_${idx}`);
  if (!input) return;
  const newCode = input.value.trim().toUpperCase();
  if (!newCode) { showToast('运单号不能为空', 'error'); return; }
  if (!/^SF\d{12,13}$/.test(newCode)) { showToast('格式错误：必须是 SF + 12-13位数字', 'error'); input.focus(); return; }
  const r = scanResults.find(x => x.idx === idx);
  if (!r) return;
  r.code = newCode;
  r.success = true;
  if (r.method === '' || !r.method) r.method = 'manual';
  renderScanTable();
  showToast(`已修改为 ${newCode}`, 'success');
}

// 取消编辑
function cancelEditScanCode(idx) {
  renderScanTable();
}

function updateScanStats() {
  const total = scanResults.length;
  const ok = scanResults.filter(r => r.success).length;
  document.getElementById('scanStats').textContent =
    `共 ${total} 张，识别成功 ${ok} 张，失败 ${total - ok} 张`;
}

// 大图预览
function openLightbox(imgSrc, info) {
  document.getElementById('lightboxImg').src = imgSrc;
  document.getElementById('lightboxInfo').innerHTML = info ? `<b>${info.replace(/\n/g, ' &nbsp;|&nbsp; ')}</b>` : '';
  document.getElementById('lightbox').classList.add('active');
}
function closeLightbox(e) {
  // 仅当点击的是 lightbox 背景本身（不是图片）时才关闭
  if (e && e.target && e.target.id !== 'lightbox') return;
  document.getElementById('lightbox').classList.remove('active');
}
// ESC 键关闭 lightbox
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// 根据运单号查询提交记录（切回记录tab并搜索）
function searchByCode(code) {
  switchTab('records');
  document.getElementById('searchInput').value = code;
  loadSubmissions();
}

// ==================== 关联识别图到提交记录 ====================

// 缓存当前选中的待关联图片（dataURL），避免转义问题
let pendingAttachImage = null;
let pendingAttachCode = null;

async function openAttachModal(code, idx) {
  pendingAttachCode = code;
  // 从 scanResults 拿图（用 idx 索引最稳）
  const r = scanResults.find(x => x.idx == idx);
  pendingAttachImage = r ? r.image : null;
  if (!pendingAttachImage) {
    showToast('该识别结果没有图片', 'error');
    return;
  }

  // 取所有 submissions，按运单号过滤
  const allSubs = await fetchAllSubmissions();
  const matched = allSubs.filter(s => s.logistics_number === code);

  const body = document.getElementById('detailBody');
  const footer = document.getElementById('modalFooter');
  document.getElementById('modalTitle').textContent = `关联识别图 → 运单号 ${code}`;

  body.innerHTML = `
    <div style="margin-bottom:16px;">
      <img src="${pendingAttachImage}" class="image-preview" style="max-height:200px;cursor:zoom-in;" alt="待关联的图" onclick="openLightbox(this.src, '待关联的识别图')">
    </div>
    <div class="section-label">匹配的提交记录（${matched.length} 条）</div>
    ${matched.length === 0
      ? `<div class="alert alert-warning">没有找到运单号为 <strong>${code}</strong> 的提交记录。<br>请先让用户提交此运单号的物流信息。</div>`
      : matched.map(s => `
        <div class="attach-item" data-id="${s.id}">
          <div class="attach-item-info">
            <div><strong>#${s.id}</strong> · ${s.username} · ${s.phone}</div>
            <div style="font-size:13px;color:#6b7280;">${formatDate(s.created_at)} · ${s.logistics_number} · 数量 ${s.quantity}</div>
            <div style="font-size:12px;margin-top:4px;">
              ${s.scan_reference_image
                ? '<span style="color:#16a34a;">✓ 已有顺丰图片（关联将覆盖）</span>'
                : '<span style="color:#9ca3af;">未关联</span>'}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="confirmAttach(${s.id})">关联到此条</button>
        </div>
      `).join('')
    }
  `;

  footer.innerHTML = `<button class="btn btn-outline" onclick="closeModal()">关闭</button>`;

  document.getElementById('detailModal').classList.add('active');
}

async function confirmAttach(submissionId) {
  if (!pendingAttachImage) {
    showToast('没有待关联的图片', 'error');
    return;
  }
  try {
    const res = await fetch(`/api/admin/submissions/${submissionId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ scan_reference_image: pendingAttachImage })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast('关联失败：' + (err.error || res.statusText), 'error');
      return;
    }
    showToast(`已关联到记录 #${submissionId}`, 'success');

    // 从「批量识别运单」列表中移除已关联的条目（避免重复关联）
    if (pendingAttachCode != null) {
      const attachedIdx = scanResults.findIndex(
        x => x.code === pendingAttachCode && x.image === pendingAttachImage
      );
      if (attachedIdx >= 0) {
        scanResults.splice(attachedIdx, 1);
        // 重新编号，让序号连续
        scanResults.forEach((r, i) => { r.idx = i + 1; });
        renderScanTable();
        updateScanStats();
      }
    }

    pendingAttachImage = null;
    pendingAttachCode = null;
    closeModal();
    // 刷新列表
    loadSubmissions();
  } catch (err) {
    showToast('关联失败：' + err.message, 'error');
  }
}

// 取所有 submissions（用于关联弹窗，不分页）
async function fetchAllSubmissions() {
  try {
    const res = await fetch('/api/admin/submissions', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.error('fetchAllSubmissions 失败:', e);
    return [];
  }
}

// 导出 CSV
function exportScanCSV() {
  if (scanResults.length === 0) {
    showToast('暂无数据可导出', 'error');
    return;
  }
  const rows = [['序号', '运单号', '识别状态', '识别方式', '文件名']];
  scanResults.forEach(r => {
    rows.push([
      r.idx,
      r.code || '',
      r.success ? '成功' : '失败',
      r.method || '',
      r.fileName || ''
    ]);
  });
  const csv = '\ufeff' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `运单识别清单_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV 已导出');
}

// 清空
function clearScanResults() {
  scanResults = [];
  renderScanTable();
  document.getElementById('scanResultCard').style.display = 'none';
  document.getElementById('scanToolbar').style.display = 'none';
  document.getElementById('scanEmptyState').style.display = 'block';
  document.getElementById('scanProgress').style.display = 'none';
  document.getElementById('scanFileInput').value = '';
}

// ==================== 初始化 ====================

loadSubmissions();

// ==================== 用户管理 ====================

// 从 JWT 解析当前用户 ID（用于禁止操作自己）
let currentUserId = null;
try {
  const payload = JSON.parse(atob(token.split('.')[1]));
  currentUserId = payload.id;
} catch (e) {}

let resetTargetUserId = null; // 重置密码时的目标用户 ID

async function openUserModal() {
  document.getElementById('userModal').classList.add('active');
  // 清空新增表单
  document.getElementById('newUsername').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('newRole').value = 'user';
  await loadUsers();
}

function closeUserModal() {
  document.getElementById('userModal').classList.remove('active');
}

async function loadUsers() {
  const tbody = document.getElementById('userTableBody');
  tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#9ca3af;">加载中...</td></tr>';
  try {
    const resp = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (resp.status === 401) { logout(); return; }
    const users = await resp.json();
    renderUsersTable(users);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#ef4444;">加载失败</td></tr>';
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('userTableBody');
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#9ca3af;">暂无用户</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const isActive = (u.status || 'active') === 'active';
    const isMe = u.id === currentUserId;
    const roleBadge = u.role === 'admin'
      ? '<span class="user-role-admin">管理员</span>'
      : '<span class="user-role-user">普通用户</span>';
    const statusBadge = isActive
      ? '<span class="user-status-active">启用</span>'
      : '<span class="user-status-frozen">已冻结</span>';
    // 自己不显示冻结/删除按钮
    const freezeBtn = isMe
      ? ''
      : isActive
        ? `<button class="btn btn-outline btn-sm" onclick="toggleFreezeUser(${u.id}, 'frozen')">冻结</button>`
        : `<button class="btn btn-outline btn-sm" onclick="toggleFreezeUser(${u.id}, 'active')">解冻</button>`;
    const resetBtn = `<button class="btn btn-outline btn-sm" onclick="openResetUserPasswordModal(${u.id}, '${u.username.replace(/'/g, "\\'")}')">重置密码</button>`;
    const deleteBtn = isMe
      ? ''
      : `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${u.username.replace(/'/g, "\\'")}')">删除</button>`;
    return `
      <tr style="border-top:1px solid #f3f4f6;">
        <td style="padding:10px;color:#9ca3af;">${u.id}${isMe ? ' <span style="color:#4f46e5;font-size:11px;">(你)</span>' : ''}</td>
        <td style="padding:10px;font-weight:600;">${u.username}</td>
        <td style="padding:10px;">${roleBadge}</td>
        <td style="padding:10px;">${statusBadge}</td>
        <td style="padding:10px;text-align:right;white-space:nowrap;">
          ${resetBtn}
          ${freezeBtn}
          ${deleteBtn}
        </td>
      </tr>
    `;
  }).join('');
}

async function createUser() {
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const role = document.getElementById('newRole').value;
  if (!username || !password) { showToast('请填写用户名和密码', 'error'); return; }

  try {
    const resp = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ username, password, role })
    });
    const data = await resp.json();
    if (!resp.ok) { showToast(data.error || '新增失败', 'error'); return; }
    showToast('用户创建成功');
    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newRole').value = 'user';
    await loadUsers();
  } catch (err) {
    showToast('网络错误', 'error');
  }
}

async function deleteUser(id, name) {
  if (!confirm(`确认删除用户「${name}」？\n\n该用户的提交记录会保留，但此用户名将无法再登录。`)) return;
  try {
    const resp = await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await resp.json();
    if (!resp.ok) { showToast(data.error || '删除失败', 'error'); return; }
    showToast('用户已删除');
    await loadUsers();
  } catch (err) {
    showToast('网络错误', 'error');
  }
}

async function toggleFreezeUser(id, status) {
  const action = status === 'frozen' ? '冻结' : '解冻';
  if (!confirm(`确认${action}该用户？`)) return;
  try {
    const resp = await fetch(`/api/admin/users/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ status })
    });
    const data = await resp.json();
    if (!resp.ok) { showToast(data.error || `${action}失败`, 'error'); return; }
    showToast(`已${action}`);
    await loadUsers();
  } catch (err) {
    showToast('网络错误', 'error');
  }
}

// ---------- 修改自己密码 ----------

function openChangeMyPasswordModal() {
  document.getElementById('myOldPassword').value = '';
  document.getElementById('myNewPassword').value = '';
  document.getElementById('myNewPassword2').value = '';
  document.getElementById('changeMyPasswordModal').classList.add('active');
}

function closeChangeMyPasswordModal() {
  document.getElementById('changeMyPasswordModal').classList.remove('active');
}

async function changeMyPassword() {
  const oldPassword = document.getElementById('myOldPassword').value;
  const newPassword = document.getElementById('myNewPassword').value;
  const newPassword2 = document.getElementById('myNewPassword2').value;
  if (!oldPassword || !newPassword) { showToast('请填写完整', 'error'); return; }
  if (newPassword.length < 6) { showToast('新密码至少 6 位', 'error'); return; }
  if (newPassword !== newPassword2) { showToast('两次输入的新密码不一致', 'error'); return; }

  try {
    const resp = await fetch('/api/change-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ oldPassword, newPassword })
    });
    const data = await resp.json();
    if (!resp.ok) { showToast(data.error || '修改失败', 'error'); return; }
    showToast('密码修改成功，下次登录请用新密码');
    closeChangeMyPasswordModal();
  } catch (err) {
    showToast('网络错误', 'error');
  }
}

// ---------- 管理员重置某用户密码 ----------

function openResetUserPasswordModal(id, name) {
  resetTargetUserId = id;
  document.getElementById('resetTargetName').textContent = name;
  document.getElementById('resetNewPassword').value = '';
  document.getElementById('resetUserPasswordModal').classList.add('active');
}

function closeResetUserPasswordModal() {
  document.getElementById('resetUserPasswordModal').classList.remove('active');
  resetTargetUserId = null;
}

async function confirmResetUserPassword() {
  const newPassword = document.getElementById('resetNewPassword').value;
  if (!newPassword || newPassword.length < 6) { showToast('新密码至少 6 位', 'error'); return; }
  if (!resetTargetUserId) { showToast('未选择用户', 'error'); return; }

  try {
    const resp = await fetch(`/api/admin/users/${resetTargetUserId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ newPassword })
    });
    const data = await resp.json();
    if (!resp.ok) { showToast(data.error || '重置失败', 'error'); return; }
    showToast('密码已重置');
    closeResetUserPasswordModal();
  } catch (err) {
    showToast('网络错误', 'error');
  }
}
