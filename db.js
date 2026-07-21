// ==================== 数据层（异步） ====================
// 双模式：有 DATABASE_URL 环境变量 → PostgreSQL；否则 → JSON 文件（本地开发）

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const usePG = !!process.env.DATABASE_URL;
let pool = null;

// ---------- PostgreSQL 模式 ----------
if (usePG) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
  });
  console.log('[db] 使用 PostgreSQL 数据库');
} else {
  console.log('[db] 使用 JSON 文件存储（本地开发模式）');
}

// ---------- JSON 文件模式实现 ----------
const DB_FILE = path.join(__dirname, 'data.json');

function loadJSON() {
  if (!fs.existsSync(DB_FILE)) return { users: [], submissions: [], nextUserId: 1, nextSubId: 1 };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
  catch { return { users: [], submissions: [], nextUserId: 1, nextSubId: 1 }; }
}
function saveJSON(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------- 初始化（建表 + 种子数据） ----------
async function init() {
  if (usePG) {
    // 建表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        phone TEXT NOT NULL,
        logistics_number TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        logistics_image TEXT,
        scan_reference_image TEXT,
        user_code TEXT,
        admin_status TEXT NOT NULL DEFAULT 'pending',
        admin_remark TEXT DEFAULT '',
        extra_fields TEXT DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // 旧库兼容：补 status 列
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`).catch(() => {});
    // 种子数据
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
    if (rows[0].c === 0) {
      const adminPass = bcrypt.hashSync('admin123', 10);
      const userPass = bcrypt.hashSync('user123', 10);
      await pool.query(
        `INSERT INTO users (username, password, role, status) VALUES
          ('admin', $1, 'admin', 'active'),
          ('user1', $2, 'user', 'active'),
          ('user2', $2, 'user', 'active')`,
        [adminPass, userPass]
      );
      console.log('[db] 已创建默认账号: admin/admin123, user1/user123, user2/user123');
    }
  } else {
    const data = loadJSON();
    // 旧数据兼容：补 status 字段
    let changed = false;
    data.users.forEach(u => {
      if (!u.status) { u.status = 'active'; changed = true; }
    });
    if (data.users.length === 0) {
      const adminPass = bcrypt.hashSync('admin123', 10);
      const userPass = bcrypt.hashSync('user123', 10);
      data.users = [
        { id: 1, username: 'admin', password: adminPass, role: 'admin', status: 'active' },
        { id: 2, username: 'user1', password: userPass, role: 'user', status: 'active' },
        { id: 3, username: 'user2', password: userPass, role: 'user', status: 'active' }
      ];
      data.nextUserId = 4;
      changed = true;
      console.log('[db] 已创建默认账号: admin/admin123, user1/user123, user2/user123');
    }
    if (changed) saveJSON(data);
  }
}

// ---------- 数据操作 API ----------
const db = {
  init,

  async getUserByName(username) {
    if (usePG) {
      const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      return rows[0] || null;
    }
    const data = loadJSON();
    return data.users.find(u => u.username === username) || null;
  },

  async getUserById(id) {
    if (usePG) {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return rows[0] || null;
    }
    const data = loadJSON();
    return data.users.find(u => u.id === Number(id)) || null;
  },

  // ---------- 用户管理（管理员用） ----------
  async getAllUsers() {
    if (usePG) {
      const { rows } = await pool.query('SELECT id, username, role, status FROM users ORDER BY id ASC');
      return rows;
    }
    const data = loadJSON();
    return data.users
      .map(u => ({ id: u.id, username: u.username, role: u.role, status: u.status || 'active' }))
      .sort((a, b) => a.id - b.id);
  },

  async createUser({ username, password, role }) {
    const hash = bcrypt.hashSync(password, 10);
    const safeRole = role === 'admin' ? 'admin' : 'user';
    if (usePG) {
      const { rows } = await pool.query(
        `INSERT INTO users (username, password, role, status) VALUES ($1, $2, $3, 'active') RETURNING id, username, role, status`,
        [username, hash, safeRole]
      );
      return rows[0];
    }
    const data = loadJSON();
    const user = {
      id: data.nextUserId++,
      username,
      password: hash,
      role: safeRole,
      status: 'active'
    };
    data.users.push(user);
    saveJSON(data);
    return { id: user.id, username: user.username, role: user.role, status: user.status };
  },

  async deleteUser(id) {
    if (usePG) {
      await pool.query('DELETE FROM users WHERE id = $1', [Number(id)]);
      return true;
    }
    const data = loadJSON();
    const before = data.users.length;
    data.users = data.users.filter(u => u.id !== Number(id));
    saveJSON(data);
    return data.users.length < before;
  },

  async updateUserStatus(id, status) {
    if (usePG) {
      const { rows } = await pool.query(
        `UPDATE users SET status = $1 WHERE id = $2 RETURNING id, username, role, status`,
        [status, Number(id)]
      );
      return rows[0] || null;
    }
    const data = loadJSON();
    const u = data.users.find(u => u.id === Number(id));
    if (!u) return null;
    u.status = status;
    saveJSON(data);
    return { id: u.id, username: u.username, role: u.role, status: u.status };
  },

  async updateUserPassword(id, newPassword) {
    const hash = bcrypt.hashSync(newPassword, 10);
    if (usePG) {
      const { rows } = await pool.query(
        `UPDATE users SET password = $1 WHERE id = $2 RETURNING id, username, role, status`,
        [hash, Number(id)]
      );
      return rows[0] || null;
    }
    const data = loadJSON();
    const u = data.users.find(u => u.id === Number(id));
    if (!u) return null;
    u.password = hash;
    saveJSON(data);
    return { id: u.id, username: u.username, role: u.role, status: u.status || 'active' };
  },

  async countAdmins() {
    if (usePG) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND (status = 'active' OR status IS NULL)`
      );
      return rows[0].c;
    }
    const data = loadJSON();
    return data.users.filter(u => u.role === 'admin' && (u.status || 'active') === 'active').length;
  },

  async createSubmission(sub) {
    if (usePG) {
      const { rows } = await pool.query(
        `INSERT INTO submissions (user_id, username, phone, logistics_number, quantity, admin_status, admin_remark, extra_fields)
         VALUES ($1, $2, $3, $4, $5, 'pending', '', '[]') RETURNING *`,
        [sub.user_id, sub.username, sub.phone, sub.logistics_number, sub.quantity]
      );
      return rows[0];
    }
    const data = loadJSON();
    const record = {
      id: data.nextSubId++,
      ...sub,
      extra_fields: '[]',
      logistics_image: null,
      user_code: null,
      admin_status: 'pending',
      admin_remark: '',
      created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };
    data.submissions.push(record);
    saveJSON(data);
    return record;
  },

  async getSubmissionsByUser(userId) {
    if (usePG) {
      const { rows } = await pool.query(
        'SELECT * FROM submissions WHERE user_id = $1 ORDER BY id DESC', [userId]
      );
      return rows;
    }
    const data = loadJSON();
    return data.submissions.filter(s => s.user_id === Number(userId)).reverse();
  },

  async getAllSubmissions(search) {
    if (usePG) {
      if (search) {
        const { rows } = await pool.query(
          'SELECT * FROM submissions WHERE logistics_number ILIKE $1 ORDER BY id DESC',
          [`%${search}%`]
        );
        return rows;
      }
      const { rows } = await pool.query('SELECT * FROM submissions ORDER BY id DESC');
      return rows;
    }
    const data = loadJSON();
    if (search) return data.submissions.filter(s => s.logistics_number.includes(search)).reverse();
    return [...data.submissions].reverse();
  },

  async getSubmissionById(id) {
    if (usePG) {
      const { rows } = await pool.query('SELECT * FROM submissions WHERE id = $1', [id]);
      return rows[0] || null;
    }
    const data = loadJSON();
    return data.submissions.find(s => s.id === Number(id)) || null;
  },

  async getLatestSubmissionByLogisticsNumber(waybill) {
    // 按运单号查最近一条记录（批量识别时用，自动关联）
    if (usePG) {
      const { rows } = await pool.query(
        'SELECT * FROM submissions WHERE logistics_number = $1 ORDER BY id DESC LIMIT 1',
        [waybill]
      );
      return rows[0] || null;
    }
    const data = loadJSON();
    return data.submissions
      .filter(s => s.logistics_number === waybill)
      .sort((a, b) => b.id - a.id)[0] || null;
  },

  async updateSubmission(id, updates) {
    if (usePG) {
      // 动态构建 UPDATE
      const keys = Object.keys(updates);
      if (keys.length === 0) return await this.getSubmissionById(id);
      const sets = keys.map((k, i) => `${k} = $${i + 1}`);
      const vals = keys.map(k => updates[k]);
      vals.push(Number(id));
      const { rows } = await pool.query(
        `UPDATE submissions SET ${sets.join(', ')} WHERE id = $${keys.length + 1} RETURNING *`,
        vals
      );
      return rows[0] || null;
    }
    const data = loadJSON();
    const sub = data.submissions.find(s => s.id === Number(id));
    if (!sub) return null;
    Object.assign(sub, updates);
    saveJSON(data);
    return sub;
  }
};

module.exports = db;
