# 错题家教 · ExamTutor

老师/家长视角的 AI 批改与错题管理:**录入一份试卷(题目+答案)→ 选学生 → 拍照上传作答 → 自动识别判分 → 错题讲解与按学生错题本**。多学生共用同一试卷,识别一次、批改多次,成本极低。

## 它能做什么

- 📚 **试卷库**:上传试卷 PDF/照片自动识别题目与标准答案;答案在另一份文件里可后续补传;只有答案没有卷子也行(自动生成题号存根,或纯手动录入);识别后可逐题核对、修改答案,修改自动重判已有批改。
- 🧑‍🎓 **多学生管理**:每个学生独立的批改记录、错题本、统计;自己刷题选「我自己」。
- 📷 **拍照批改**:手机直接调摄像头,支持 JPG/PNG/WebP/HEIC;**可以只拍一部分,之后随时「补拍补传」**,已判结果与人工修正不丢失;照片在浏览器内先压缩再上传,省流量。
- ✅ **秒出判分**:代码对照标准答案判分;涂改/字迹模糊的题不瞎猜,标「待确认」交人工核对。
- 💡 **逐题讲解**:错题讲解后台陆续生成(考点/解析/错因/技巧/例句),点开未生成的题自动插队。
- 💬 **自由答疑**:针对某道题或整卷随时追问 AI 家教。
- 📒 **错题本 / 📈 统计**:跨试卷按知识点汇总,可按学生筛选。
- 📱 **PWA**:手机浏览器「添加到主屏幕」即为全屏 App;也可用 GitHub Actions 打包安卓 APK(见下文)。

## 架构

```
React SPA (Vite + TS + Tailwind, PWA)
   │  cookie 会话(JWT) · SSE 实时进度(+轮询兜底)
   ▼
FastAPI ── SQLite(WAL) + data/ 文件存储
   │
   ├─ 作业队列(2 worker)
   │   试卷入库:渲染每页(PyMuPDF/PIL) → Gemini 全量识别(题目+答案) → 入库复用
   │   作答批改:照片归一化 → Gemini 只输出 题号→学生答案 的小 JSON → 代码判分
   │            └ 视觉结果按文件 SHA-256 缓存,同文件零成本(跨试卷/跨提交复用)
   │
   └─ 讲解优先级队列(1 worker)
        DeepSeek 批量讲解错题(后台预生成;用户点开插队)/ 实时答疑
```

**成本设计**:视觉输出 token 价格是输入的数倍——试卷只全量转写一次,学生作答只让模型输出 `题号→答案`(输出 token 省 ~80-90%);1280px 灰度渲染;按文件指纹缓存识别结果;空白页跳过。

**为什么判分放在代码里**:视觉模型只负责"看见什么",合并、判分、低置信度降级都在 Python 中完成,稳、快、可审计。

## 快速开始

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cp .env.example .env      # 填密钥与 JWT_SECRET(见 .env.example 注释)

cd frontend && npm install && npm run build && cd ..

./run.sh                  # 默认 0.0.0.0:8080
```

浏览器打开服务地址,**第一个注册的账号自动成为管理员**(无需邀请码);之后在「设置」里生成邀请码给其他人。

### 环境变量(`.env`)

| 变量 | 说明 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter 密钥,供 Gemini 视觉识别 |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥,供讲解/答疑 |
| `JWT_SECRET` | 会话签名密钥(必填,生成方式见 .env.example) |
| `ALLOW_OPEN_REGISTER` | 设 `1` 开放注册;默认邀请码制 |
| `COOKIE_SECURE` | 有 HTTPS 反代时设 `1` |
| `MAX_UPLOAD_MB` / `MAX_PAGES` | 上传体积/页数上限,默认 30 / 30 |
| `RENDER_MAX_DIM` | 渲染最长边(视觉成本主杠杆),默认 `1280` |
| `VISION_CONCURRENCY` | 视觉并发,小内存机器建议 `2-3` |

完整列表见 `.env.example`。`.env` 已被 `.gitignore` 忽略,切勿提交密钥。

## 部署(systemd + HTTPS)

```bash
sudo cp deploy/exam-tutor.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now exam-tutor
```

建议前置 Caddy 做自动 HTTPS,并把 `COOKIE_SECURE=1`、`EXAMTUTOR_HOST=127.0.0.1`(只走反代)。Caddyfile 注意:**SSE 路径(`/events$`)不要启用 gzip 压缩**,否则进度推送会被缓冲:

```caddy
your.domain {
    @sse path_regexp /events$
    handle @sse {
        reverse_proxy 127.0.0.1:8000 { flush_interval -1 }
    }
    handle {
        encode gzip
        reverse_proxy 127.0.0.1:8000
    }
}
```

## 打包安卓 APK

仓库自带 `.github/workflows/android-apk.yml`(Capacitor 套壳,WebView 直连你的服务器):

1. 在仓库 **Settings → Secrets and variables → Actions → Variables** 添加 `APP_SERVER_URL`(如 `https://your.domain`);
2. 手动触发 **Actions → Android APK → Run workflow**(或推送 frontend 改动自动触发);
3. 构建完成后在 run 页面 **Artifacts** 下载 APK 直接安装。

不想折腾 APK 的话,手机浏览器打开网站「添加到主屏幕」即是 PWA 全屏应用。

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/register` `/login` `/logout` | 注册(邀请码)/ 登录 / 登出 |
| `GET/POST` | `/api/students` | 学生列表 / 新增(自动含「我自己」) |
| `POST` | `/api/papers` | 上传试卷文件建卷(可多文件) |
| `POST` | `/api/papers/manual` | 不传文件,纯手动建卷 |
| `POST` | `/api/papers/{id}/files` | 补传答案/题目文件,自动重新汇总 |
| `PATCH` | `/api/papers/{id}/questions/{qid}` | 核对/修改标准答案并同步重判 |
| `POST` | `/api/submissions` | 提交批改:学生+试卷+照片/PDF |
| `POST` | `/api/jobs/{id}/files` | 补拍补传,增量重跑 |
| `GET` | `/api/jobs/{id}/events` | SSE:进度 / 完成 / 讲解就绪 |
| `POST` | `/api/jobs/{id}/questions/{qid}/override` | 人工修正(补拍不覆盖) |
| `POST` | `/api/jobs/{id}/ask` | 答疑(可带 `qid` 聚焦某题) |
| `GET` | `/api/mistakes` `/api/stats/overview` | 错题本 / 统计(`?student_id=` 筛选) |

所有资源接口校验归属,越权一律 404。

## 项目结构

```
backend/
  app/
    config.py     配置与密钥
    db.py         SQLite 连接 + schema 迁移
    store.py      DAO(users/students/papers/jobs/questions/chat)
    auth.py       bcrypt + JWT(httpOnly cookie) + 归属校验
    security.py   上传校验(PDF/图片) / 限流 / 安全响应头
    workers.py    作业队列 + 讲解优先级队列
    events.py     SSE 事件总线
    pdf_utils.py  PDF/照片 → 页面图(EXIF 矫正/限边长/空白页检测)
    prompts.py    提示词(试卷全量识别 / 作答小输出识别 / 讲解 / 答疑)
    llm.py        Gemini 视觉 / DeepSeek 客户端
    pipeline.py   试卷入库 + 作答判分 + 补拍合并
    routers/      auth / students / papers / jobs / questions / chat / insights
  scripts/        数据迁移脚本
frontend/         React + Vite + TS + Tailwind(构建产物 dist/ 由后端托管)
deploy/           systemd 单元
data/             SQLite(app.db) + 试卷/批改文件 + 视觉识别缓存(不入库)
```

## 已知限制

- 简答/翻译等手写长文本难以稳定自动比对,标「待确认」交人工;涂改不清的选择题同样不瞎猜。
- 作文等主观题不自动判分,可让 AI 家教点评。
- 单进程部署(内存态队列/限流/SSE),不支持多 uvicorn worker;家庭/小班规模绰绰有余。
