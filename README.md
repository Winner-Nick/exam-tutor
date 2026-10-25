# 错题家教 · ExamTutor

老师/家长视角的 AI 批改与错题管理:**录入一份试卷(题目+答案)→ 选学生 → 拍照上传作答 → 自动识别判分 → 错题讲解与按学生错题本**。多学生共用同一试卷,识别一次、批改多次,成本极低。

## 它能做什么

- 📚 **试卷库**:上传 PDF/照片识别题目与答案,支持手动建卷、题目/选项/答案/知识点编辑、学科与年级配置;重识别保留人工修改并同步重判历史提交。
- 🧑‍🎓 **多学生管理**:学生独立批改、错题、统计与登录账号;老师和管理员可重置密码,旧会话自动失效。
- 📷 **拍照批改**:支持 JPG/PNG/WebP/HEIC/PDF、浏览器压缩、上传进度/取消和补拍;单页失败明确标为「部分识别」,可用原文件重试或明确接受。
- ✅ **可核对判分**:代码判分,低置信度与缺答案客观题标「待确认」;填空/简答可修正文本作答,无客观题时不误报全对或 0%。
- 💡 **逐题讲解与整卷答疑**:按题目版本生成讲解,答疑带真实题目、作答、统计和阅读原文;学科/年级可在试卷设置中调整。
- 📒 **错题复习**:按知识点筛选,支持到期复习、1/3/7/16/30 天递进间隔、重新作答、掌握/恢复、复习记录、CSV 导出与打印。
- 📈 **学习统计**:个人与班级分开呈现,支持时间范围、待确认/主观题摘要、知识点覆盖率和搜索分页。
- 🧭 **完整教程**:首次登录向导、真实页面交互导览、老师/学生分角色教程中心、学习清单、FAQ 与打印教程。
- 📱 **PWA**:手机「添加到主屏幕」,含离线说明页且不缓存私有学习数据;也可用 GitHub Actions 打包安卓 APK。

## 架构

```
React SPA (Vite + TS + Tailwind, PWA)
   │  cookie 会话(JWT) · SSE 实时进度(+轮询兜底)
   ▼
FastAPI ── SQLite(WAL) + data/ 文件存储
   │
   ├─ 作业队列(2 worker)
   │   试卷入库:渲染每页(PyMuPDF/PIL) → DeepSeek 全量识别(题目+答案) → 入库复用
   │   作答批改:照片归一化 → DeepSeek 只输出 题号→学生答案 的小 JSON → 代码判分
   │            └ 视觉结果按文件 SHA-256 与提取版本缓存,同文件同版本零成本复用
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

浏览器打开服务地址,**第一个注册的账号自动成为管理员**(无需邀请码);之后在「设置」里生成邀请码给其他人。首次登录可查看分角色向导,也可随时从顶部「教程」重新打开交互导览。

忘记密码时,学生找老师、老师找管理员重置;管理员无法登录时,由服务器管理人员在本机运行 `.venv/bin/python -m backend.scripts.reset_password 用户名 新密码`。重置后旧会话全部失效。

### 环境变量(`.env`)

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek 中转密钥,供视觉识别/讲解/答疑 |
| `DEEPSEEK_BASE_URL` | DeepSeek 中转的 OpenAI 兼容地址 |
| `JWT_SECRET` | 会话签名密钥(必填,生成方式见 .env.example) |
| `ALLOW_OPEN_REGISTER` | 设 `1` 开放注册;默认邀请码制 |
| `COOKIE_SECURE` | 有 HTTPS 反代时设 `1` |
| `MAX_UPLOAD_MB` / `MAX_PAGES` | 上传体积/页数上限,默认 30 / 30 |
| `RENDER_MAX_DIM` | 渲染最长边(视觉成本主杠杆),默认 `1280` |
| `VISION_CONCURRENCY` | 视觉并发,小内存机器建议 `2-3` |

视觉与文本统一使用 `deepseek-v4-1-flash-261017`。模型在 `backend/app/config.py` 中随代码和缓存协议固定，不再通过 `VISION_MODEL` / `DEEPSEEK_MODEL` 环境变量切换；升级模型时必须同步升级缓存版本并跑识别回归，旧缓存不会混入新链路。

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
| `POST` | `/api/papers/{id}/retry` `/jobs/{id}/retry` | 使用原文件重试;部分结果另有 `/accept-partial` |
| `GET` | `/api/jobs/{id}/events` | SSE:进度 / 完成 / 讲解就绪 |
| `POST` | `/api/jobs/{id}/questions/{qid}/override` | 人工修正(补拍不覆盖) |
| `POST` | `/api/jobs/{id}/questions/{qid}/review` | 复习作答、掌握/恢复与间隔排期 |
| `POST` | `/api/jobs/{id}/ask` | 带真实试卷上下文答疑(可带 `qid` 聚焦某题) |
| `GET` | `/api/mistakes` `/api/stats/overview` | 错题复习 / 统计(学生、试卷、复习状态、时间等筛选) |

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
    llm.py        DeepSeek 视觉与文本统一客户端
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
