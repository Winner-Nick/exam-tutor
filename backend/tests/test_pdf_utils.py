from __future__ import annotations

import io

import fitz
import pytest
from PIL import Image

from app import pdf_utils, store


def test_photo_rejects_excess_pixels_before_decode(monkeypatch):
    monkeypatch.setattr(pdf_utils, "MAX_IMAGE_PIXELS", 100)
    directory = store.job_dir("pdf-pixels")
    source = directory / "large.png"
    Image.new("RGB", (20, 20), "white").save(source)

    with pytest.raises(ValueError, match="像素"):
        pdf_utils.validate_image(source)
    with pytest.raises(ValueError, match="像素"):
        pdf_utils.photo_to_page(source, directory / "pages", 1)


def test_pdf_rejects_excess_render_pixels_before_render(monkeypatch):
    monkeypatch.setattr(pdf_utils, "MAX_RENDER_PIXELS", 100)
    directory = store.job_dir("pdf-render-limit")
    source = directory / "page.pdf"
    document = fitz.open()
    document.new_page(width=100, height=100)
    document.save(source)
    document.close()

    with pytest.raises(ValueError, match="渲染像素上限"):
        pdf_utils.render_pdf_to_images(source, directory / "pages", dpi=72)


def test_transparent_photo_is_flattened_onto_white():
    directory = store.job_dir("pdf-alpha")
    source = directory / "transparent.png"
    Image.new("RGBA", (2, 2), (255, 0, 0, 0)).save(source)

    output = pdf_utils.photo_to_page(source, directory / "pages", 1, max_dim=2)
    with Image.open(output) as image:
        red, green, blue = image.convert("RGB").getpixel((0, 0))
        assert red > 240 and green > 240 and blue > 240


def test_image_upload_validation_works_through_api(admin_client):
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), "white").save(buffer, format="PNG")
    response = admin_client.post(
        "/api/papers",
        data={"title": "图片上传验证"},
        files=[("files", ("page.png", buffer.getvalue(), "image/png"))],
    )
    assert response.status_code == 201, response.text
    assert response.json()["paper_id"]
