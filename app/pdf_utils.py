"""PDF 处理：把每一页渲染成图片，供视觉模型识别。"""
from __future__ import annotations

import base64
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

from .config import settings


def page_count(pdf_path: str | Path) -> int:
    doc = fitz.open(pdf_path)
    try:
        return doc.page_count
    finally:
        doc.close()


def render_pdf_to_images(
    pdf_path: str | Path,
    out_dir: str | Path,
    dpi: int | None = None,
    max_dim: int = 1600,
    quality: int = 85,
) -> list[Path]:
    """把 PDF 每页渲染为 JPEG。返回图片路径列表（按页序）。

    为控制视觉接口的体积/成本，最长边限制在 max_dim 像素内。
    """
    dpi = dpi or settings.render_dpi
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    paths: list[Path] = []
    try:
        for i, page in enumerate(doc):
            pix = page.get_pixmap(dpi=dpi, alpha=False)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            if max(img.size) > max_dim:
                scale = max_dim / max(img.size)
                img = img.resize(
                    (round(img.width * scale), round(img.height * scale)),
                    Image.LANCZOS,
                )
            out = out_dir / f"page_{i + 1:02d}.jpg"
            img.save(out, "JPEG", quality=quality)
            paths.append(out)
    finally:
        doc.close()
    return paths


def image_to_data_url(path: str | Path) -> str:
    path = Path(path)
    mime = "image/jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else "image/png"
    b64 = base64.b64encode(path.read_bytes()).decode()
    return f"data:{mime};base64,{b64}"
