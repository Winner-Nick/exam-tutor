# 错题家教 · ExamTutor

上传一份**含作答与答案**的试卷 PDF，自动识别每道题、对照答案判分、找出错题并逐一讲解；还能随时就任意一道题或知识点向 AI 家教提问。多用户账号隔离，附跨试卷错题本与成绩统计。

> 实测样卷：《2026 北京朝阳初三二模英语》（扫描件，12 页，38 题）。

## 它能做什么

- 📄 **自动识别**：把扫描/拍照试卷逐页转成结构化题目（题干、选项、学生手写作答、参考答案）。
- ✅ **秒出判分**：对照同卷答案，标出 _答对 / 答错 / 待确认 / 主观题_；判分完成立即可看。
- 💡 **逐题讲解**：错题讲解后台陆续生成（考点 / 解析 / 错因 / 技巧 / 例句），点开未生成的题自动插队优先。
- 💬 **自由答疑**：针对某道题或整卷随时追问，AI 家教结合题目上下文作答。
- 📒 **错题本**：跨试卷按知识点汇总错题，温故知新。
- 📈 **统计面板**：历次正确率趋势、知识点错误率排行。
- 👨‍👩‍👧 **多用户**：账号注册（邀请码制）+ 登录，每人只看到自己的试卷。
- 📖 **对照原卷** / 🌙 **深浅主题** / 📱 **移动端适配**。

## 架构

```
React SPA (Vite + TS + Tailwind)
   │  cookie 会话(JWT) · SSE 实时进度
   ▼
FastAPI ── SQLite(WAL) + data/ 文件存储
   │
   ├─ 作业队列(2 worker)
   │    PDF ─> 渲染每页为图片(PyMuPDF, 灰度/限边长)
   │            │  同内容 PDF 自动复用旧识别结果（SHA-256 去重，0 成本）
   │            ▼
   │    👁 Gemini Flash（OpenRouter）逐页视觉识别
   │            ▼
   │    代码合并 + 对照判分（稳健，不依赖大模型生成长 JSON）──> 立即 done
   │
   └─ 讲解优先级队列(1 worker)
        🧠 DeepSeek 批量讲解错题（后台预生成；用户点开插队）/ 实时答疑
```

**为什么判分放在代码里**：让大模型重新输出全部题目的长 JSON 容易超长截断、且会改写原文。视觉模型只负责"看见什么"，合并、去重、判分在 Python 中完成，更稳、更快、可控。

**成本控制**（视觉识别是大头）：渲染默认最长边 1280px + 灰度 + JPEG q80（实测识别率与 1600px 彩色一致）；同一 PDF 重复上传（哪怕不同账号）直接复用识别缓存；空白页不调模型；讲解按"后台预生成 + 按需插队"混合策略。

## 快速开始

```bash
cd exam-tutor
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cp .env.example .env      # 填密钥与 JWT_SECRET（见 .env.example 注释）

# 构建前端（或在开发机构建后 rsync frontend/dist/ 上来）
cd frontend && npm install && npm run build && cd ..

./run.sh                  # 默认 0.0.0.0:8080
```

浏览器打开 `http://<服务器IP>:8080`，**第一个注册的账号自动成为管理员**（无需邀请码）；之后在「设置」里生成邀请码给家人使用。

### 旧版数据迁移（JSON → SQLite，一次性）

```bash
.venv/bin/python -m backend.scripts.migrate_json_jobs --admin-user 你的用户名 --admin-password '你的密码'
```

### 前端开发

```bash
cd frontend && npm run dev   # Vite 5173 端口，/api 代理到 127.0.0.1:8080
```

### 环境变量（`.env`）

| 变量 | 说明 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter 密钥，供 Gemini 视觉识别 |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥，供讲解/答疑 |
| `JWT_SECRET` | 会话签名密钥（必填，生成方式见 .env.example） |
| `ALLOW_OPEN_REGISTER` | 设 `1` 开放注册；默认邀请码制 |
| `COOKIE_SECURE` | 有 HTTPS 反代时设 `1` |
| `MAX_UPLOAD_MB` / `MAX_PAGES` | 上传体积/页数上限，默认 30 / 30 |
| `RENDER_MAX_DIM` | 渲染最长边（视觉成本主杠杆），默认 `1280` |
| `RENDER_GRAYSCALE` | 灰度渲染，默认开 |
| `VISION_CONCURRENCY` | 视觉并发，小内存机器建议 `2-3` |

完整列表见 `.env.example`。`.env` 已被 `.gitignore` 忽略，切勿提交密钥。

## 作为服务常驻（systemd）

```bash
sudo cp deploy/exam-tutor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now exam-tutor
```

公网访问需在云厂商**安全组**放行对应 TCP 端口（默认 8080）。建议前置 caddy/nginx 做 HTTPS 并把 `COOKIE_SECURE` 设为 `1`。

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/register` `/login` `/logout` | 注册（邀请码）/ 登录 / 登出 |
| `POST` | `/api/upload` | 上传 PDF，返回 `job_id` |
| `GET` | `/api/jobs` / `/api/jobs/{id}` | 我的试卷列表 / 详情 |
| `GET` | `/api/jobs/{id}/events` | SSE：进度 / 完成 / 讲解就绪 |
| `POST` | `/api/jobs/{id}/questions/{qid}/override` | 修正答案/状态并重判 |
| `POST` | `/api/jobs/{id}/questions/{qid}/explain` | 插队优先生成讲解 |
| `POST` | `/api/jobs/{id}/ask` | 答疑（可带 `qid` 聚焦某题） |
| `GET` | `/api/mistakes` / `/api/stats/overview` | 错题本 / 统计 |

所有 `/api/jobs/*` 接口校验作业归属，越权一律 404。

## 项目结构

```
backend/
  app/
    config.py     配置与密钥
    db.py         SQLite 连接 + schema 迁移
    store.py      DAO（users/jobs/questions/chat）
    auth.py       bcrypt + JWT(httpOnly cookie) + 归属校验
    security.py   上传校验 / 限流 / 安全响应头
    workers.py    作业队列 + 讲解优先级队列
    events.py     SSE 事件总线
    pdf_utils.py  PDF → 图片（灰度/限边长/空白页检测）
    prompts.py    提示词
    llm.py        Gemini 视觉 / DeepSeek 客户端
    pipeline.py   渲染→识别→合并判分（讲解走队列）
    routers/      auth / jobs / questions / chat / insights
  scripts/        旧 JSON 数据迁移
frontend/         React + Vite + TS + Tailwind（构建产物 dist/ 由后端托管）
deploy/           systemd 单元
run.sh            启动脚本（单进程，勿加 workers）
data/             SQLite(app.db) + 各作业的 PDF/页面图/识别缓存
```

## 已知限制

- 简答/翻译等**手写文本**作答难以稳定自动比对，统一标为「待确认」，由用户自评或追问 AI。
- 作文等主观题不自动判分，可让 AI 家教点评。
- 学生作答识别依赖卷面清晰度；可在题目详情处一键修正。
- 单进程部署（内存态队列/限流/SSE），不支持多 uvicorn worker；家庭规模够用。
