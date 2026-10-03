from io import BytesIO
from typing import Any

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

from ..values import as_text


def _apply_acroform(
    source: bytes,
    mappings: list[dict],
    values: dict[str, Any],
) -> bytes:
    reader = PdfReader(BytesIO(source))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)

    field_values = {}
    for mapping in mappings:
        if mapping["locatorType"] != "PDF_ACROFORM":
            continue
        field_key = mapping["fieldKey"]
        if field_key not in values:
            continue
        pdf_field = mapping.get("sourcePath")
        if not pdf_field:
            raise ValueError(f"Missing PDF field name for {field_key}")
        field_values[pdf_field] = as_text(values[field_key], mapping.get("inputType"))

    if field_values:
        for page in writer.pages:
            writer.update_page_form_field_values(
                page,
                field_values,
                auto_regenerate=False,
            )

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _make_overlay(page_width: float, page_height: float, items: list[tuple[dict, str]]) -> bytes:
    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=(page_width, page_height))

    for locator, value in items:
        x = float(locator["x"])
        y = float(locator["y"])
        font_size = float(locator.get("fontSize", 9))
        leading = float(locator.get("leading", font_size * 1.2))
        max_chars = int(locator.get("maxCharsPerLine", 0))

        c.setFont("Helvetica", font_size)
        text_object = c.beginText(x, y)
        text_object.setLeading(leading)

        lines = value.splitlines() or [""]
        if max_chars > 0:
            wrapped = []
            for line in lines:
                while len(line) > max_chars:
                    split_at = line.rfind(" ", 0, max_chars + 1)
                    if split_at <= 0:
                        split_at = max_chars
                    wrapped.append(line[:split_at].rstrip())
                    line = line[split_at:].lstrip()
                wrapped.append(line)
            lines = wrapped

        max_lines = int(locator.get("maxLines", len(lines) or 1))
        for line in lines[:max_lines]:
            text_object.textLine(line)

        c.drawText(text_object)

    c.save()
    return stream.getvalue()


def _apply_coordinate_overlays(
    source: bytes,
    mappings: list[dict],
    values: dict[str, Any],
) -> bytes:
    reader = PdfReader(BytesIO(source))
    writer = PdfWriter()

    by_page: dict[int, list[tuple[dict, str]]] = {}
    for mapping in mappings:
        if mapping["locatorType"] != "PDF_COORDINATE":
            continue
        field_key = mapping["fieldKey"]
        if field_key not in values:
            continue
        locator = mapping.get("locatorJson") or {}
        page_index = int(locator.get("page", 0))
        by_page.setdefault(page_index, []).append(
            (locator, as_text(values[field_key], mapping.get("inputType")))
        )

    for index, page in enumerate(reader.pages):
        items = by_page.get(index)
        if items:
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            overlay_reader = PdfReader(BytesIO(_make_overlay(width, height, items)))
            page.merge_page(overlay_reader.pages[0])
        writer.add_page(page)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def render_pdf(
    source: bytes,
    mappings: list[dict],
    values: dict[str, Any],
) -> bytes:
    result = source
    if any(mapping["locatorType"] == "PDF_ACROFORM" for mapping in mappings):
        result = _apply_acroform(result, mappings, values)
    if any(mapping["locatorType"] == "PDF_COORDINATE" for mapping in mappings):
        result = _apply_coordinate_overlays(result, mappings, values)
    return result
