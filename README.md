# 物流信息管理系统

> 用户提交物流信息 → 管理员审核 → 运单 OCR 批量识别 → 自动关联识别图到提交记录

基于 Node.js + Express 的物流信息管理系统，支持本地 JSON 文件存储和 PostgreSQL 双模式，集成 RapidOCR 运单文字识别。

---

## 功能概览

### 用户端（普通用户）
- 登录 → 提交物流信息（手机号 / 物流单号 / 商品数量）
- 查看自己的提交记录
- 管理员上传物流图片后，提交 6 位验证码
- 查看管理员审核结果（成功/失败 + 备注）

### 管理端（管理员）
- 查看所有用户提交记录，按物流单号搜索
- 查看详情：物流信息、用户验证码、管理员备注
- **修改物流单号**（纠正用户提交错误）
- 上传物流图片（base64 存库，兼容云平台）
- 标记审核结果：成功 / 失败
- **批量识别运单**（上传多张图片 → OCR 自动识别 SF 运单号）
- **关联识别图到记录**（自动按运单号匹配 + 手动关联按钮）

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express + JWT + bcryptjs + multer |
| 数据层 | JSON 文件（本地） / PostgreSQL（生产，`pg` 库） |
| 前端 | 原生 HTML / CSS / JS（无框架） |
| 运单识别 | Python + RapidOCR (PaddleOCR ONNX 轻量版) |
| 部署 | Render (Web Service + PostgreSQL) / CloudStudio (纯前端版) |

---

## 目录结构

```
logistics-system/
├── server.js              # Express 服务器 + 全部 API 路由 (405 行)
├── db.js                  # 数据层：JSON / PostgreSQL 双模式 (215 行)
├── recognize.py           # OCR 识别脚本（RapidOCR + 正则提取运单号）
├── data.json              # JSON 模式的本地数据存储
├── package.json
├── render.yaml            # Render Blueprint 部署配置
├── DEPLOY.md              # 部署到 Render 的详细指南
│
├── public/                # 后端模式的前端静态资源
│   ├── index.html         # 登录页
│   ├── user.html          # 用户面板
│   ├── admin.html         # 管理面板（含「提交记录」+「批量识别」两个 tab）
│   ├── scanner.html       # 独立扫描页（早期版本，已被 admin tab 取代）
│   ├── css/style.css
│   └── js/
│       ├── user.js        # 用户端逻辑 (191 行)
│       └── admin.js       # 管理端逻辑 (723 行)
│
└── dist/                  # 纯前端版（部署到 CloudStudio，数据存 localStorage）
    ├── index.html
    ├── user.html
    ├── admin.html
    ├── css/style.css
    └── js/
        ├── app.js         # localStorage 数据层
        ├── user.js
        └── admin.js
```

---

## 快速启动（本地开发）

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务器

```bash
npm start
# 或后台稳定运行（shell 退出不杀进程）
nohup node server.js > /tmp/server.log 2>&1 & disown
```

### 3. 访问系统

打开浏览器访问 **http://localhost:3000**

### 4. 默认账号

| 角色 | 用户名 | 密码 |
|---|---|---|
| 管理员 | `admin` | `admin123` |
| 用户 | `user1` | `user123` |
| 用户 | `user2` | `user123` |

> 默认账号在首次启动时由 `db.js` 的 `init()` 自动创建，密码用 bcrypt 哈希存储。

---

## API 接口文档

所有 API 响应均带 `Cache-Control: no-store` 头，避免浏览器缓存旧数据。

### 认证

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/login` | 公开 | 登录，返回 JWT token |
| GET | `/api/me` | 登录 | 获取当前用户信息 |

### 用户接口

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/submissions` | 登录 | 提交物流信息（手机号/物流单号/商品数量） |
| GET | `/api/submissions` | 登录 | 查看自己的提交记录 |
| POST | `/api/submissions/:id/code` | 登录 | 提交 6 位验证码 |

### 管理员接口

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/admin/submissions` | 管理员 | 查看所有提交记录（支持搜索） |
| GET | `/api/admin/submissions/:id` | 管理员 | 查看单条详情 |
| PUT | `/api/admin/submissions/:id` | 管理员 | 修改记录（logistics_number / phone / quantity / admin_remark / scan_reference_image） |
| POST | `/api/admin/submissions/:id/upload` | 管理员 | 上传物流图片（multipart，base64 存库） |
| POST | `/api/admin/submissions/:id/status` | 管理员 | 标记审核结果（success / failed） |

### 运单识别

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/scan-barcode` | 公开 | 批量识别运单（支持 multipart 多文件 或 JSON base64 数组） |

**请求示例（multipart）：**
```bash
curl -X POST http://localhost:3000/api/scan-barcode \
  -F "images=@waybill1.jpg" \
  -F "images=@waybill2.jpg"
```

**请求示例（JSON base64）：**
```bash
curl -X POST http://localhost:3000/api/scan-barcode \
  -H "Content-Type: application/json" \
  -d '{"images":["data:image/jpeg;base64,..."]}'
```

**响应示例：**
```json
{
  "results": [
    {
      "success": true,
      "code": "SF5111950066792",
      "method": "ocr",
      "candidates": ["SF5111950066792"],
      "all_texts": ["顺丰速运", "运单号：SF5111950066792", "..."],
      "error": null
    }
  ]
}
```

---

## 运单识别功能详解

### 识别原理

采用 **OCR 文字识别**方案（非条形码解码），因为运单上的条形码容易被红色绳子/胶带物理遮挡，但文字版运单号始终可读。

### 识别流程

```
上传图片 → Node 后端写临时文件 → spawn Python 子进程
       → RapidOCR 识别所有文字 → 正则提取 SF\d{12,13}
       → 按置信度排序取最优 → 返回 JSON
```

### 识别规则（关键）

```python
# recognize.py 第 12 行
WAYBILL_PATTERN = re.compile(r'SF\d{12,13}')
```

**只识别顺丰运单号**：`SF` + 12 或 13 位数字（顺丰 14/15 位两种长度）。

**不识别的内容：**
- ❌ 商品溯源码（`SFTB8009014378` 格式，一物一码防伪标）
- ❌ 浏览器页面截图（含 UI 文字，OCR 会误读）
- ❌ 其他快递公司运单号（京东 JD、圆通 YT 等不匹配）
- ❌ 模糊、遮挡、透视变形严重的图片

### Python 环境

独立 venv，路径：`C:/Users/majianfeng/.workbuddy/binaries/python/envs/ocr/`

依赖：`rapidocr-onnxruntime`（无需 paddlepaddle，ONNX 模型自带）

**路径配置（server.js 第 272-274 行）：**
```javascript
const PYTHON_EXE = process.env.PYTHON_EXE ||
  'C:/Users/majianfeng/.workbuddy/binaries/python/envs/ocr/Scripts/python.exe';
const BARCODE_SCRIPT = path.join(__dirname, 'recognize.py');
```

### 手动测试 OCR

```bash
"C:/Users/majianfeng/.workbuddy/binaries/python/envs/ocr/Scripts/python.exe" \
  recognize.py public/uploads/your_image.jpeg
```

输出 JSON 数组，含 `waybill`（识别到的运单号或 null）、`all_texts`（所有识别到的文字）、`candidates`（候选运单号）。

---

## 关联识别图到记录

### 自动关联

`/api/scan-barcode` 识别成功后，**异步**按运单号查找匹配的 submission，把识别图存入 `scan_reference_image` 字段。

- 不覆盖已有识别图（避免重复识别冲掉用户手动关联的图）
- 只关联最新一条匹配的 submission

### 手动关联

对于之前未自动关联的记录，管理员可在「批量识别」tab 点「关联」按钮：
1. 弹窗显示该识别图
2. 列出匹配运单号的所有 submission
3. 选择一条 → PUT `scan_reference_image` 到选中记录

**涉及函数（public/js/admin.js）：**
- `openAttachModal(waybill, image)` - 打开关联弹窗
- `confirmAttach(submissionId)` - 确认关联
- `fetchAllSubmissions()` - 拉取所有提交记录（用 fetch + Bearer token）

---

## 部署

### 本地开发（JSON 文件存储）

不配置 `DATABASE_URL` 环境变量时，自动用 JSON 文件存储，无需数据库。

### Render 部署（PostgreSQL 多用户共享）

详见 **[DEPLOY.md](./DEPLOY.md)**，支持三种方案：
- 方案 A：Render Blueprint 一键部署（推荐）
- 方案 B：手动创建 Web Service + PostgreSQL
- 方案 C：用 Neon 永久免费数据库

### CloudStudio 部署（纯前端版）

`dist/` 目录是纯前端版本，数据存浏览器 localStorage，已部署到：
`https://f40f25b3b4074d5ba4bae39d1636b275.app.codebuddy.work`

> ⚠️ 限制：数据存浏览器本地，不跨设备共享，仅适合演示/单机使用。

---

## 数据库结构（PostgreSQL 模式）

### users 表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | SERIAL | 主键 |
| username | TEXT | 用户名（唯一） |
| password | TEXT | bcrypt 哈希密码 |
| role | TEXT | `admin` 或 `user` |
| phone | TEXT | 联系电话 |
| created_at | TIMESTAMP | 创建时间 |

### submissions 表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | SERIAL | 主键 |
| user_id | INT | 关联 users.id |
| phone | TEXT | 收件人手机号 |
| logistics_number | TEXT | 物流单号 |
| quantity | INT | 商品数量 |
| image_path | TEXT | 管理员上传的物流图片（base64） |
| user_code | TEXT | 用户提交的 6 位验证码 |
| admin_remark | TEXT | 管理员备注 |
| status | TEXT | `pending` / `success` / `failed` |
| scan_reference_image | TEXT | 关联的识别参考图（base64） |
| extra_fields | JSON | 扩展字段（已停用） |
| created_at | TIMESTAMP | 创建时间 |

---

## 关键文件索引

| 文件 | 行数 | 职责 |
|---|---|---|
| `server.js` | 405 | Express 服务器、全部 API 路由、OCR 子进程调度 |
| `db.js` | 215 | 数据层抽象：JSON 文件 / PostgreSQL 双模式 |
| `recognize.py` | 95 | RapidOCR 识别 + 正则提取运单号 |
| `public/js/admin.js` | 723 | 管理端全部逻辑（提交记录 + 批量识别 + 关联） |
| `public/js/user.js` | 191 | 用户端逻辑 |

---

## 已知问题与注意事项

### 运单识别
- **只认顺丰 SF + 12~13 位数字**，不认 SFTB 溯源码、京东 JD 等
- 图片必须是**真实顺丰面单**（白底黑字），不要拍绿色防伪标签
- 拍摄要求：整张面单入镜、字体清晰、避免反光/遮挡/透视变形

### 服务器稳定性（Windows）
- 用 `nohup node server.js > /tmp/server.log 2>&1 & disown` 启动，shell 退出不杀进程
- 端口冲突时用 `/c/Windows/System32/taskkill.exe /F /PID <pid>` 杀进程（Git Bash 下 `taskkill` 可能失效）
- 已加 `process.on('uncaughtException')` 防止 multer 等模块错误导致静默崩溃

### 数据存储
- 本地 JSON 模式：数据存 `data.json`，重启不丢
- Render 免费层 PostgreSQL 90 天有效，长期用建议迁移到 Neon（永久免费 500MB）
- Render 免费层 15 分钟无请求会休眠，唤醒约 30-60 秒
- 图片用 base64 存库，量大时建议改用对象存储（Cloudflare R2 / AWS S3）

### 前端缓存
- 所有 `/api` 响应带 `no-store` 头，避免浏览器缓存旧数据
- 修改代码后必须重启服务器才生效

---

## 业务流程图

```
用户                    管理员                  系统
 │                        │                      │
 ├─ 登录 ────────────────────────────────────────►
 ├─ 提交物流信息 ────────────────────────────────► 存入 submissions 表
 │                        │                      │
 │                        ├─ 登录 ───────────────►
 │                        ├─ 查看所有提交 ───────►
 │                        ├─ 上传物流图片 ───────► 存 base64
 │                        │                      │
 ├─ 看到图片 ─────────────────────────────────────►
 ├─ 提交 6 位验证码 ──────────────────────────────► 存 user_code
 │                        │                      │
 │                        ├─ 查看验证码 ─────────►
 │                        ├─ 标记成功/失败 ──────► 存 status
 │                        │                      │
 ├─ 查看审核结果 ────────────────────────────────►
 │                        │                      │
 │                        ├─ 批量识别运单 ───────► OCR 识别 SF 运单号
 │                        ├─ 自动关联识别图 ─────► 存 scan_reference_image
 │                        ├─ 手动关联（补漏）────► PUT scan_reference_image
 │                        │                      │
 │                        ├─ 修改物流单号 ───────► PUT logistics_number
```
