# 错题精讲 · ExamTutor

上传一份**含作答与答案**的试卷 PDF，自动识别每道题、对照答案判分、找出错题并逐一讲解；还能随时就任意一道题或知识点向 AI 家教提问。

> 实测样卷：《2026 北京朝阳初三二模英语》（扫描件，12 页，38 题）。

## 它能做什么

- 📄 **自动识别**：把扫描/拍照试卷逐页转成结构化题目（题干、选项、学生手写作答、参考答案）。
- ✅ **自动判分**：对照同卷答案，标出 _答对 / 答错 / 待确认 / 主观题_。
- 💡 **逐题讲解**：对错题与待确认题给出「考点 / 答案分析 / 错因 / 技巧 / 例句」。
- 💬 **自由答疑**：针对某道题或整卷，随时追问，AI 家教结合题目上下文作答。
- 🖱️ **自由浏览**：题目宫格按状态着色，一键筛选错题；可手动修正自己的答案后即时重判并生成讲解。
- 📖 **对照原卷**：随时查看渲染后的原始卷面。

## 架构

```
PDF ──> 渲染每页为图片(PyMuPDF)
          │
          ├─> 👁 Gemini Flash（OpenRouter）逐页视觉识别  ──┐
          │     题干/选项/学生作答/答案区                  │
          │                                               ▼
          │                                   代码合并 + 对照判分（稳健，不依赖大模型生成长JSON）
          │                                               │
          └─────────────────────────────────────────────>│
                                                          ▼
                                  🧠 DeepSeek 对错题逐批讲解 / 实时答疑
```

**为什么判分放在代码里**：让大模型重新输出全部题目的长 JSON 容易超长截断、且会改写原文。视觉模型只负责"看见什么"，合并、去重、判分在 Python 中完成，更稳、更快、可控。

- **视觉识别**：`google/gemini-3.5-flash`（经 OpenRouter）——读扫描件、识别手写作答。
- **文本推理**：`deepseek-v4-flash`（DeepSeek 官方 API）——讲解与答疑。
- **后端**：FastAPI + 后台线程处理 + 作业状态轮询；作业数据以 JSON 持久化于 `data/`。
- **前端**：零构建的原生 SPA（HTML/CSS/JS），FastAPI 直接托管，省内存、易部署。

## 快速开始

```bash
cd exam-tutor
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cp .env.example .env      # 填入你的密钥（见下）
./run.sh                  # 默认 0.0.0.0:8000
```

浏览器打开 `http://<服务器IP>:8000`。

### 环境变量（`.env`）

| 变量 | 说明 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter 密钥，供 Gemini 视觉识别 |
| `VISION_MODEL` | 视觉模型，默认 `google/gemini-3.5-flash` |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥，供讲解/答疑 |
| `DEEPSEEK_MODEL` | 文本模型，默认 `deepseek-v4-flash` |
| `EXAMTUTOR_PORT` | 监听端口，默认 `8000` |
| `RENDER_DPI` | PDF 渲染清晰度，默认 `150` |
| `VISION_CONCURRENCY` | 视觉并发，小内存机器建议 `2-3` |

> `.env` 已被 `.gitignore` 忽略，切勿提交密钥。

## 作为服务常驻（systemd）

```bash
sudo cp deploy/exam-tutor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now exam-tutor
```

公网访问需在云厂商**安全组**放行对应 TCP 端口（本项目默认 8000）。

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/upload` | 上传 PDF，返回 `job_id` |
| `GET` | `/api/jobs/{id}` | 查询进度/结果 |
| `GET` | `/api/jobs/{id}/page/{n}` | 取某页原卷图片 |
| `POST` | `/api/jobs/{id}/questions/{qid}/override` | 修正答案/状态，重判并按需讲解 |
| `POST` | `/api/jobs/{id}/ask` | 答疑（可带 `qid` 聚焦某题） |

## 项目结构

```
app/
  config.py     配置与密钥
  pdf_utils.py  PDF → 图片
  prompts.py    提示词
  llm.py        Gemini 视觉 / DeepSeek 客户端
  pipeline.py   渲染→识别→合并判分→讲解
  store.py      作业持久化
  main.py       FastAPI 路由
static/         零构建前端（index.html / css / js）
deploy/         systemd 单元
run.sh          启动脚本
```

## 已知限制

- 简答/翻译等**手写文本**作答难以稳定自动比对，统一标为「待确认」，由用户自评或追问 AI。
- 作文等主观题不自动判分，可让 AI 家教点评。
- 学生作答识别依赖卷面清晰度；可在题目详情处一键修正。
