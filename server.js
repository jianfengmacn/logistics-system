const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const db = require('./db');

const app = express();

// 全局异常捕获，避免 multer 等模块的内部错误导致进程静默挂掉
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack || err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err && err.stack || err);
});
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'logistics-system-secret-2026';

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 所有 API 响应禁用浏览器缓存，避免数据更新后浏览器还显示旧数据
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// 文件上传配置：使用内存存储，转 base64 存数据库（兼容云平台临时文件系统）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持图片文件 (jpg/jpeg/png/gif/bmp/webp)'));
    }
  }
});

// ==================== 认证中间件 ====================

function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: '登录已过期' });
  }
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
    next();
  });
}

// ==================== 工具函数 ====================

function formatSubmission(row) {
  if (!row) return null;
  return {
    ...row,
    extra_fields: row.extra_fields ? (typeof row.extra_fields === 'string' ? JSON.parse(row.extra_fields) : row.extra_fields) : [],
    created_at: row.created_at ? new Date(row.created_at).toISOString().replace('T', ' ').substring(0, 19) : null
  };
}

// ==================== 认证接口 ====================

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });

  try {
    const user = await db.getUserByName(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    // 冻结用户禁止登录
    if (user.status === 'frozen') {
      return res.status(403).json({ error: '该账号已被冻结，请联系管理员' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: '24h' });
    res.json({ token, role: user.role, username: user.username });
  } catch (err) {
    console.error('登录错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

// 修改自己的密码（任何已登录用户）
app.put('/api/change-password', authRequired, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '请输入旧密码和新密码' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });

  try {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (!bcrypt.compareSync(oldPassword, user.password)) {
      return res.status(400).json({ error: '旧密码错误' });
    }
    await db.updateUserPassword(req.user.id, newPassword);
    res.json({ success: true });
  } catch (err) {
    console.error('修改密码错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ==================== 用户接口 ====================

app.post('/api/submissions', authRequired, async (req, res) => {
  const { phone, logistics_number, quantity } = req.body;
  if (!phone || !logistics_number || !quantity) {
    return res.status(400).json({ error: '请填写完整信息' });
  }
  if (!/^1\d{10}$/.test(phone)) {
    return res.status(400).json({ error: '请输入正确的手机号码' });
  }
  const qty = parseInt(quantity);
  if (isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: '商品数量必须为正整数' });
  }

  try {
    const submission = await db.createSubmission({
      user_id: req.user.id,
      username: req.user.username,
      phone,
      logistics_number,
      quantity: qty
    });
    res.json(formatSubmission(submission));
  } catch (err) {
    console.error('创建提交错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/submissions', authRequired, async (req, res) => {
  try {
    const rows = await db.getSubmissionsByUser(req.user.id);
    res.json(rows.map(formatSubmission));
  } catch (err) {
    console.error('获取提交列表错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/submissions/:id/code', authRequired, async (req, res) => {
  const { code } = req.body;
  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: '请输入6位数字' });
  }

  try {
    const sub = await db.getSubmissionById(req.params.id);
    if (!sub || sub.user_id !== req.user.id) return res.status(404).json({ error: '记录不存在' });
    // 任一图片存在即可（管理员上传的 logistics_image 或批量识别关联的 scan_reference_image）
    if (!sub.logistics_image && !sub.scan_reference_image) {
      return res.status(400).json({ error: '管理员尚未提供物流图片' });
    }

    const updated = await db.updateSubmission(req.params.id, { user_code: code });
    res.json(formatSubmission(updated));
  } catch (err) {
    console.error('提交验证码错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ==================== 管理员接口 ====================

// ---------- 用户管理 ----------

// 列出所有用户
app.get('/api/admin/users', adminRequired, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (err) {
    console.error('获取用户列表错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 新增用户
app.post('/api/admin/users', adminRequired, async (req, res) => {
  const { username, password, role } = req.body;
  const u = String(username || '').trim();
  const p = String(password || '');
  if (u.length < 2 || u.length > 20) return res.status(400).json({ error: '用户名 2-20 个字符' });
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return res.status(400).json({ error: '用户名只能包含字母、数字、下划线' });
  if (p.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

  try {
    const exists = await db.getUserByName(u);
    if (exists) return res.status(400).json({ error: '用户名已存在' });
    const user = await db.createUser({ username: u, password: p, role });
    res.json(user);
  } catch (err) {
    console.error('新增用户错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 删除用户
app.delete('/api/admin/users/:id', adminRequired, async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: '不能删除自己' });

  try {
    const target = await db.getUserById(targetId);
    if (!target) return res.status(404).json({ error: '用户不存在' });
    // 删除的是 active admin，要保证至少剩 1 个
    if (target.role === 'admin' && (target.status || 'active') === 'active') {
      const adminCount = await db.countAdmins();
      if (adminCount <= 1) return res.status(400).json({ error: '至少保留 1 个启用状态的管理员' });
    }
    await db.deleteUser(targetId);
    res.json({ success: true });
  } catch (err) {
    console.error('删除用户错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 冻结 / 解冻
app.patch('/api/admin/users/:id/status', adminRequired, async (req, res) => {
  const { status } = req.body;
  if (!['active', 'frozen'].includes(status)) {
    return res.status(400).json({ error: '状态值无效（active / frozen）' });
  }
  const targetId = Number(req.params.id);
  if (targetId === req.user.id && status === 'frozen') {
    return res.status(400).json({ error: '不能冻结自己' });
  }

  try {
    const target = await db.getUserById(targetId);
    if (!target) return res.status(404).json({ error: '用户不存在' });
    // 冻结的是 admin，要保证至少剩 1 个 active admin
    if (status === 'frozen' && target.role === 'admin' && (target.status || 'active') === 'active') {
      const adminCount = await db.countAdmins();
      if (adminCount <= 1) return res.status(400).json({ error: '至少保留 1 个启用状态的管理员' });
    }
    const updated = await db.updateUserStatus(targetId, status);
    res.json(updated);
  } catch (err) {
    console.error('修改用户状态错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员重置某用户密码
app.put('/api/admin/users/:id/password', adminRequired, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: '新密码至少 6 位' });
  }
  const targetId = Number(req.params.id);

  try {
    const target = await db.getUserById(targetId);
    if (!target) return res.status(404).json({ error: '用户不存在' });
    await db.updateUserPassword(targetId, String(newPassword));
    res.json({ success: true });
  } catch (err) {
    console.error('重置用户密码错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ---------- 提交记录管理 ----------

app.get('/api/admin/submissions', adminRequired, async (req, res) => {
  try {
    const { search } = req.query;
    const rows = await db.getAllSubmissions(search);
    res.json(rows.map(formatSubmission));
  } catch (err) {
    console.error('获取所有提交错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/admin/submissions/:id', adminRequired, async (req, res) => {
  try {
    const sub = await db.getSubmissionById(req.params.id);
    if (!sub) return res.status(404).json({ error: '记录不存在' });
    res.json(formatSubmission(sub));
  } catch (err) {
    console.error('获取提交详情错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 保存审核备注 / 修改物流单号
app.put('/api/admin/submissions/:id', adminRequired, async (req, res) => {
  const { admin_remark, logistics_number, phone, quantity, scan_reference_image } = req.body;
  try {
    const sub = await db.getSubmissionById(req.params.id);
    if (!sub) return res.status(404).json({ error: '记录不存在' });

    const updates = {};
    if (admin_remark !== undefined) updates.admin_remark = admin_remark;
    if (logistics_number !== undefined) {
      const v = String(logistics_number).trim();
      if (!v) return res.status(400).json({ error: '物流单号不能为空' });
      updates.logistics_number = v;
    }
    if (phone !== undefined) {
      if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '请输入正确的手机号码' });
      updates.phone = phone;
    }
    if (quantity !== undefined) {
      const qty = parseInt(quantity);
      if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: '商品数量必须为正整数' });
      updates.quantity = qty;
    }
    if (scan_reference_image !== undefined) {
      // 必须是 data:image/...;base64,... 格式（允许 null/空字符串以清空）
      if (scan_reference_image === null || scan_reference_image === '') {
        updates.scan_reference_image = null;
      } else if (typeof scan_reference_image !== 'string' || !/^data:image\/\w+;base64,/.test(scan_reference_image)) {
        return res.status(400).json({ error: 'scan_reference_image 必须是 data:image/...;base64 格式' });
      } else {
        updates.scan_reference_image = scan_reference_image;
      }
    }

    const updated = await db.updateSubmission(req.params.id, updates);
    res.json(formatSubmission(updated));
  } catch (err) {
    console.error('保存错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 上传物流图片（内存 → base64 → 数据库）
app.post('/api/admin/submissions/:id/upload', adminRequired, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片文件' });

  try {
    const sub = await db.getSubmissionById(req.params.id);
    if (!sub) return res.status(404).json({ error: '记录不存在' });

    // 转 base64 data URL
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const updated = await db.updateSubmission(req.params.id, { logistics_image: base64 });
    res.json(formatSubmission(updated));
  } catch (err) {
    console.error('上传图片错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员设置状态
app.post('/api/admin/submissions/:id/status', adminRequired, async (req, res) => {
  const { status, remark } = req.body;
  if (!['success', 'failure'].includes(status)) {
    return res.status(400).json({ error: '状态值无效' });
  }

  try {
    const sub = await db.getSubmissionById(req.params.id);
    if (!sub) return res.status(404).json({ error: '记录不存在' });
    const updated = await db.updateSubmission(req.params.id, {
      admin_status: status,
      admin_remark: remark || ''
    });
    res.json(formatSubmission(updated));
  } catch (err) {
    console.error('设置状态错误:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ==================== 条形码识别接口（调用 Python） ====================

const { recognize } = require('./ocr');

/**
 * 单张图片条形码识别（接收 base64 数据）
 * POST /api/scan-barcode
 * body: { image: "data:image/jpeg;base64,..." }
 * 或: { images: ["data:image/...", ...] }  批量
 */
app.post('/api/scan-barcode', upload.array('images', 20), async (req, res) => {
  try {
    let imageBuffers = [];
    let originalDataUrls = []; // 保留原始 dataUrl，用于关联到提交记录

    // 支持两种方式：multipart 文件上传 或 JSON base64
    if (req.files && req.files.length > 0) {
      imageBuffers = req.files.map(f => ({ buffer: f.buffer, ext: '.jpg' }));
      originalDataUrls = imageBuffers.map((img, i) => {
        const mime = req.files[i].mimetype || 'image/jpeg';
        return `data:${mime};base64,${img.buffer.toString('base64')}`;
      });
    } else if (req.body.images && Array.isArray(req.body.images)) {
      imageBuffers = req.body.images.map(dataUrl => {
        const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        const ext = m ? '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]) : '.jpg';
        const b64 = m ? m[2] : dataUrl;
        return { buffer: Buffer.from(b64, 'base64'), ext };
      });
      originalDataUrls = req.body.images;
    } else if (req.body.image) {
      const dataUrl = req.body.image;
      const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      const ext = m ? '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]) : '.jpg';
      const b64 = m ? m[2] : dataUrl;
      imageBuffers = [{ buffer: Buffer.from(b64, 'base64'), ext }];
      originalDataUrls = [dataUrl];
    }

    if (imageBuffers.length === 0) {
      return res.status(400).json({ error: '没有提供图片' });
    }

    // 调用 OCR（腾讯云 / Python 兜底，由 ocr.js 根据环境变量自动切换）
    let rawResults;
    try {
      rawResults = await recognize(imageBuffers);
    } catch (err) {
      console.error('OCR 调用失败:', err);
      return res.status(500).json({ error: '识别失败: ' + err.message });
    }

    // 转换为前端期望的格式: { success, code, method, candidates }
    const results = rawResults.map(r => ({
      success: !!r.waybill,
      code: r.waybill || '',
      method: r.method || 'ocr',
      candidates: r.candidates || [],
      all_texts: r.all_texts || [],
      error: r.error || null
    }));

    // 异步按运单号关联到提交记录（已有识别图的保留，不覆盖）
    results.forEach((r, i) => {
      if (r.success && r.code && originalDataUrls[i]) {
        (async () => {
          try {
            const sub = await db.getLatestSubmissionByLogisticsNumber(r.code);
            if (sub && !sub.scan_reference_image) {
              await db.updateSubmission(sub.id, { scan_reference_image: originalDataUrls[i] });
              console.log(`[scan] 关联识别图: submission #${sub.id} (${r.code})`);
            }
          } catch (e) {
            console.error('[scan] 关联识别图失败:', e);
          }
        })();
      }
    });

    return res.json({ results });
  } catch (err) {
    console.error('条形码识别错误:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
});

// ==================== 启动服务器 ====================

(async () => {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`  物流信息管理系统已启动`);
      console.log(`  访问地址: http://localhost:${PORT}`);
      console.log(`  模式: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON 文件'}`);
      console.log(`========================================\n`);
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
})();
