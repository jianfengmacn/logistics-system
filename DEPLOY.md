# 物流信息管理系统 — 部署到 Render 指南

本指南帮你把系统部署到 Render（免费云平台），实现**多用户/多设备真正共享数据**。

---

## 方案 A：Render Blueprint 一键部署（推荐，最简单）

项目已包含 `render.yaml` 配置文件，可一键创建 Web 服务 + PostgreSQL 数据库。

### 步骤

1. **把代码上传到 GitHub**
   - 在本地项目根目录初始化 git 并推送到 GitHub：
   ```bash
   git init
   git add .
   git commit -m "物流信息管理系统"
   git branch -M main
   git remote add origin https://github.com/你的用户名/logistics-system.git
   git push -u origin main
   ```
   - 如果没有 GitHub 账号，先注册一个（免费）。

2. **在 Render 创建 Blueprint**
   - 打开 https://render.com ，用 GitHub 账号登录
   - 点击右上角 **New +** → **Blueprint**
   - 选择你刚推送的 `logistics-system` 仓库
   - Render 会自动识别 `render.yaml`，显示要创建的资源：
     - `logistics-system`（Web 服务）
     - `logistics-db`（PostgreSQL 数据库）
   - 点击 **Apply** 开始创建

3. **等待部署完成**
   - Render 会自动安装依赖、启动服务
   - 部署完成后，在 `logistics-system` 服务页面顶部能看到公网地址，形如：
     `https://logistics-system-xxxx.onrender.com`
   - 点击即可访问系统！

4. **开始使用**
   - 默认账号（部署后自动创建）：
     - 管理员：`admin` / `admin123`
     - 用户：`user1` / `user123`
     - 用户：`user2` / `user123`
   - 现在所有用户访问同一个地址，数据共享！

---

## 方案 B：手动部署（如果 Blueprint 不成功）

### 1. 创建数据库
- 登录 Render → **New +** → **PostgreSQL**
- Name 填 `logistics-db`，Plan 选 `Free`
- 创建后，在数据库详情页找到 **Internal Database URL**，复制备用

### 2. 创建 Web 服务
- **New +** → **Web Service**
- 连接你的 GitHub 仓库
- 填写配置：
  - **Name**: `logistics-system`
  - **Runtime**: `Node`
  - **Build Command**: `npm install`
  - **Start Command**: `npm start`
  - **Plan**: `Free`
- 在 **Environment** 中添加环境变量：
  | Key | Value |
  |-----|-------|
  | `DATABASE_URL` | （粘贴上一步复制的数据库 URL） |
  | `PGSSL` | `false` |
  | `JWT_SECRET` | （随便填一串字符，或点 Generate） |
- 点击 **Create Web Service**

### 3. 等待部署完成，获取公网地址

---

## 方案 C：用 Neon 永久免费数据库（推荐长期使用）

Render 自带 PostgreSQL 免费层只有 90 天。如需永久免费，用 [Neon](https://neon.tech)：

1. 注册 Neon（免费），创建一个项目
2. 复制连接字符串（形如 `postgresql://user:pass@host/db`）
3. 在 Render Web 服务的环境变量里，把 `DATABASE_URL` 设为 Neon 的连接字符串
4. 把 `PGSSL` 设为 `false`（Neon 自带 SSL，pg 库默认启用）
5. 重启 Web 服务即可

> Neon 免费层：500MB 存储、永久免费、Serverless 自动休眠。

---

## 本地开发

不配置 `DATABASE_URL` 环境变量时，系统自动用 JSON 文件存储（无需数据库）：

```bash
npm install
npm start
# 访问 http://localhost:3000
```

---

## 常见问题

**Q: 部署后打开页面报错？**
A: 查看 Render 服务页面的 Logs（日志）标签，看是否有启动错误。常见原因是环境变量没配好。

**Q: 免费层会休眠吗？**
A: Render 免费层 15 分钟无请求会自动休眠，下次访问时自动唤醒（约等 30-60 秒）。如需常驻可升级付费层。

**Q: 数据会丢失吗？**
A: PostgreSQL 数据库的数据是持久化的，不会因服务重启/重新部署而丢失。但免费层数据库 90 天后到期（Render 自带），届时迁移到 Neon 即可。

**Q: 如何修改默认账号密码？**
A: 首次部署时自动创建默认账号。如需修改，登录后通过数据库管理界面操作，或在 `db.js` 的 `init()` 函数里修改种子数据后重新部署（注意：重新部署不会重复创建已存在的账号）。

**Q: 图片上传占用数据库空间怎么办？**
A: 图片已压缩为 base64 存入数据库。如图片很多，建议改用对象存储（如 Cloudflare R2、AWS S3）。免费层 500MB-1GB 一般够用。

---

## 系统架构

```
用户/管理员浏览器
      ↓
  Render Web Service (Node.js + Express)
      ↓
  PostgreSQL 数据库（Render / Neon）
      - users 表（账号）
      - submissions 表（提交记录 + base64 图片）
```

## 完整业务流程

1. **用户**登录 → 提交（手机号、物流单号、商品数量）
2. **管理员**登录 → 查看所有提交 → 上传物流图片 → 保存
3. **用户**查看详情 → 看到图片 → 输入6位验证码提交
4. **管理员**查看验证码 → 标记成功/失败 + 备注
5. **用户**查看审核结果
