"""集中配置：从 .env 读取密钥与运行参数。"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")

DATA_DIR = Path(os.getenv("EXAMTUTOR_DATA_DIR") or (BASE_DIR / "data"))
JOBS_DIR = DATA_DIR / "jobs"
PAPERS_DIR = DATA_DIR / "papers"
VISION_CACHE_DIR = DATA_DIR / "vision_cache"  # 按文件 sha 缓存视觉识别结果，跨试卷/作答复用
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
for _d in (JOBS_DIR, PAPERS_DIR, VISION_CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class Settings:
    # 视觉识别（OpenRouter -> Gemini Flash）
    openrouter_api_key: str = os.getenv("OPENROUTER_API_KEY", "")
    openrouter_base_url: str = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    vision_model: str = os.getenv("VISION_MODEL", "google/gemini-3.5-flash")

    # 文本推理（DeepSeek）
    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    deepseek_base_url: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")

    # 服务与处理参数
    host: str = os.getenv("EXAMTUTOR_HOST", "0.0.0.0")
    port: int = int(os.getenv("EXAMTUTOR_PORT", "8080"))
    render_dpi: int = int(os.getenv("RENDER_DPI", "150"))
    render_max_dim: int = int(os.getenv("RENDER_MAX_DIM", "1280"))  # 最长边像素；视觉 token 成本的主杠杆
    render_quality: int = int(os.getenv("RENDER_QUALITY", "80"))
    render_grayscale: bool = os.getenv("RENDER_GRAYSCALE", "1") == "1"  # 黑白试卷无损，体积省 ~60%
    vision_concurrency: int = int(os.getenv("VISION_CONCURRENCY", "3"))

    # 认证与安全
    jwt_secret: str = os.getenv("JWT_SECRET", "")
    allow_open_register: bool = os.getenv("ALLOW_OPEN_REGISTER", "0") == "1"
    cookie_secure: bool = os.getenv("COOKIE_SECURE", "0") == "1"  # 有 HTTPS 时设 1
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "30"))
    max_pages: int = int(os.getenv("MAX_PAGES", "30"))
    max_processing_per_user: int = int(os.getenv("MAX_PROCESSING_PER_USER", "2"))

    def validate(self) -> list[str]:
        problems = []
        if not self.openrouter_api_key:
            problems.append("缺少 OPENROUTER_API_KEY（视觉识别用）")
        if not self.deepseek_api_key:
            problems.append("缺少 DEEPSEEK_API_KEY（文本推理用）")
        if not self.jwt_secret:
            problems.append("缺少 JWT_SECRET（会话签名用，可用 secrets.token_urlsafe(48) 生成）")
        return problems


settings = Settings()
