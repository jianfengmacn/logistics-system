# 公网部署操作指引（Render + tesseract.js）

代码层面已准备好部署。默认 OCR 用 **tesseract.js**（纯 JS，完全免费，零外部依赖），**不需要注册任何云账号**。

剩下 2 件事：① 把代码推到 GitHub ② 在 Render 一键部署。

---

## 一、把代码推到 GitHub

### 1. 注册 GitHub（如果没账号）
打开 https://github.com/signup 注册一个免费账号。

### 2. 在 GitHub 创建空仓库
1. 点右上角 **+** → **New repository**
2. Repository name 填 `logistics-system`
3. 选 **Private**（推荐，私有仓库）
4. **不要勾** "Add a README" / .gitignore / license（项目已有）
5. 点 **Create repository**
6. 复制仓库地址，形如 `https://github.com/你的用户名/logistics-system.git`

### 3. 本地推送
在项目目录（`C:\Users\majianfeng\WorkBuddy\2026-07-20-13-04-33`）打开终端，执行：

```bash
# 关联远程仓库（替换成你的地址）
git remote add origin https://github.com/你的用户名/logistics-system.git

# 推送
git push -u origin main
```

第一次推送会让你登录 GitHub，按提示输入用户名和 Personal Access Token（不是密码）。Token 在 https://github.com/settings/tokens 生成，勾 `repo` 权限即可。

---

## 二、在 Render 部署

### 1. 注册 Render
打开 https://render.com 用 GitHub 账号登录（一键授权）。

### 2. 创建 Blueprint
1. 右上角 **New +** → **Blueprint**
2. 选择刚推送的 `logistics-system` 仓库
3. Render 会自动识别 `render.yaml`，显示要创建：
   - `logistics-system`（Web 服务）
   - `logistics-db`（PostgreSQL 数据库）
4. 点 **Apply** 开始创建

### 3. 等待部署
1. 部署过程中（约 3-5 分钟）会自动装依赖、启动服务
2. **不需要配任何环境变量**，tesseract.js 开箱即用

### 4. 获取公网地址
服务详情页顶部有公网地址，形如：
```
https://logistics-system-xxxx.onrender.com
```
点开就是你的系统。默认账号：
- 管理员：`admin` / `admin123`
- 用户：`user1` / `user123`

---

## 三、验证部署

1. 打开公网地址，看到登录页 ✓
2. 用 admin 登录 ✓
3. 上传一张顺丰面单图片到「批量识别运单」→ 应该能识别出 SF 开头的运单号 ✓
   - 首次识别会稍慢（tesseract.js 下载语言数据 + 初始化，约 10-20 秒），之后正常
4. 用 user1 登录 → 提交一条记录 → admin 关联顺丰图 → user1 看到图 → 输码 → admin 终审 ✓

---

## 可选升级：腾讯云 OCR（提高识别率）

tesseract.js 默认识别率约 80%（对清晰的 SF+数字组合够用）。如果识别率不满足需求，可升级到腾讯云 OCR（识别率 90%+，免费 1000 次/月）：

### 1. 注册腾讯云 + 开通 OCR
1. https://cloud.tencent.com/register 注册 + 实名认证
2. https://console.cloud.tencent.com/ocr 开通 OCR（通用印刷体免费 1000 次/月）
3. https://console.cloud.tencent.com/cam/capi 创建 API 密钥，保存 SecretId / SecretKey

### 2. 在 Render 配置环境变量
进入 `logistics-system` 服务详情页 → **Environment** → 添加：
- `TENCENT_SECRET_ID` = 你的腾讯云 SecretId
- `TENCENT_SECRET_KEY` = 你的腾讯云 SecretKey

加完 **Save Changes** 自动重新部署。配了密钥后自动走腾讯云 OCR，不配则用 tesseract.js。

> ⚠️ 密钥不要发到群里、不要提交到 git、不要截图。只在 Render 控制台填。

---

## 常见问题

**Q: 推送 GitHub 报 "Authentication failed"**
A: 不要用密码，用 Personal Access Token。https://github.com/settings/tokens 生成时勾 `repo`，把 token 当密码粘进去。

**Q: Render 部署后打开页面 502/超时**
A: 免费层冷启动慢，第一次访问可能要等 30-60 秒。看 Logs 标签的启动日志确认服务起来了。

**Q: 上传图片识别失败 / 识别慢**
A: tesseract.js 首次识别会下载语言数据（约 15MB），耗时 10-20 秒，之后正常。如果持续识别不出运单号，检查图片是否清晰、是否顺丰面单（SF 开头）。识别率不够可升级腾讯云 OCR（见上方"可选升级"）。

**Q: 免费层会休眠吗？**
A: 会，15 分钟无请求自动休眠，下次访问自动唤醒（30-60 秒）。需要常驻升级付费层（约 $7/月）。

**Q: 数据会丢吗？**
A: PostgreSQL 数据持久化，不会丢。但 Render 自带 PostgreSQL 免费层 90 天到期，到期前迁移到 Neon（https://neon.tech 永久免费）即可。

---

## 时间预估
- GitHub 注册 + 创建仓库 + 推送：5-10 分钟
- Render 部署：10-15 分钟
- **总计：15-25 分钟**（不升级腾讯云的话）

有问题随时问我。
