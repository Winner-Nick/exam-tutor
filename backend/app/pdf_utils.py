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
    max_dim: int | None = None,
    quality: int | None = None,
    grayscale: bool | None = None,
) -> list[Path]:
    """把 PDF 每页渲染为 JPEG。返回图片路径列表（按页序）。

    最长边限制在 max_dim 像素内——这是视觉模型 token 成本的主要杠杆；
    灰度不省 token 但 base64 体积小得多，省内存与带宽。
    """
    dpi = dpi or settings.render_dpi
    max_dim = max_dim or settings.render_max_dim
    quality = quality or settings.render_quality
    grayscale = settings.render_grayscale if grayscale is None else grayscale
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
            if grayscale:
                img = img.convert("L")
            out = out_dir / f"page_{i + 1:02d}.jpg"
            img.save(out, "JPEG", quality=quality)
            paths.append(out)
    finally:
        doc.close()
    return paths


def is_blank_page(image_path: str | Path, dark_ratio_threshold: float = 0.005) -> bool:
    """近似空白页判定：缩样后非白像素占比低于阈值。空白页直接跳过视觉识别。"""
    with Image.open(image_path) as img:
        g = img.convert("L")
        g.thumbnail((256, 256))
        hist = g.histogram()
    total = sum(hist)
    dark = sum(hist[:240])  # 灰度 < 240 视为"有内容"
    return total > 0 and dark / total < dark_ratio_threshold


def image_to_data_url(path: str | Path) -> str:
    path = Path(path)
    mime = "image/jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else "image/png"
    b64 = base64.b64encode(path.read_bytes()).decode()
    return f"data:{mime};base64,{b64}"
