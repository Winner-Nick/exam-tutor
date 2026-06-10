"""PDF/图片处理：把每一页（或每张拍照）归一化为页面图，供视觉模型识别。"""
from __future__ import annotations

import base64
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image, ImageOps

from .config import settings

try:  # iPhone 拍照默认 HEIC，注册后 PIL 可直接打开
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:
    pass


def page_count(pdf_path: str | Path) -> int:
    doc = fitz.open(pdf_path)
    try:
        return doc.page_count
    finally:
        doc.close()


def _normalize(img: Image.Image, max_dim: int, grayscale: bool) -> Image.Image:
    if max(img.size) > max_dim:
        scale = max_dim / max(img.size)
        img = img.resize(
            (round(img.width * scale), round(img.height * scale)),
            Image.LANCZOS,
        )
    if grayscale:
        img = img.convert("L")
    return img


def render_pdf_to_images(
    pdf_path: str | Path,
    out_dir: str | Path,
    dpi: int | None = None,
    max_dim: int | None = None,
    quality: int | None = None,
    grayscale: bool | None = None,
    start_index: int = 0,
) -> list[Path]:
    """把 PDF 每页渲染为 JPEG（页码从 start_index+1 起）。返回图片路径列表（按页序）。

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
            img = _normalize(img, max_dim, grayscale)
            out = out_dir / f"page_{start_index + i + 1:02d}.jpg"
            img.save(out, "JPEG", quality=quality)
            paths.append(out)
    finally:
        doc.close()
    return paths


def photo_to_page(
    src: str | Path,
    out_dir: str | Path,
    page_index: int,
    max_dim: int | None = None,
    quality: int | None = None,
) -> Path:
    """把一张拍照/截图归一化为页面图（EXIF 矫正方向 + 限边长）。

    拍照件不转灰度：彩色笔迹（红笔批改、蓝黑墨水）在灰度下对比度会损失。
    """
    max_dim = max_dim or settings.render_max_dim
    quality = quality or settings.render_quality
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img = _normalize(img, max_dim, grayscale=False)
        out = out_dir / f"page_{page_index:02d}.jpg"
        img.save(out, "JPEG", quality=quality)
    return out


def is_blank_page(image_path: str | Path, dark_ratio_threshold: float = 0.0008) -> bool:
    """近似空白页判定：缩样后非白像素占比低于阈值。空白页直接跳过视觉识别。

    阈值要足够保守：内容稀疏的"参考答案"页可能只有 0.3% 非白像素，
    渲染出的真空白页则接近 0。宁可多花一次识别也不能漏页。"""
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
