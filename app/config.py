"""集中配置：从 .env 读取密钥与运行参数。"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DATA_DIR = BASE_DIR / "data"
JOBS_DIR = DATA_DIR / "jobs"
STATIC_DIR = BASE_DIR / "static"
JOBS_DIR.mkdir(parents=True, exist_ok=True)


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
    vision_concurrency: int = int(os.getenv("VISION_CONCURRENCY", "3"))

    def validate(self) -> list[str]:
        problems = []
        if not self.openrouter_api_key:
            problems.append("缺少 OPENROUTER_API_KEY（视觉识别用）")
        if not self.deepseek_api_key:
            problems.append("缺少 DEEPSEEK_API_KEY（文本推理用）")
        return problems


settings = Settings()
