from typing import Any

from .docx import render_docx
from .pdf import render_pdf
from .xlsx import render_xlsx


class UnsupportedOfficialFormFormat(ValueError):
    pass


def render_official_document(
    source: bytes,
    original_name: str,
    mime_type: str,
    mappings: list[dict],
    values: dict[str, Any],
) -> tuple[bytes, str]:
    name = original_name.lower()
    mime = (mime_type or "").lower()

    if name.endswith(".pdf") or mime == "application/pdf":
        return render_pdf(source, mappings, values), "application/pdf"

    if (
        name.endswith(".docx")
        or mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        return (
            render_docx(source, mappings, values),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

    if (
        name.endswith(".xlsx")
        or mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ):
        return (
            render_xlsx(source, mappings, values),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    if name.endswith(".doc") or name.endswith(".xls"):
        raise UnsupportedOfficialFormFormat(
            "Legacy DOC/XLS is preserved as an original source but automatic filling is blocked "
            "until a layout-safe renderer is configured."
        )

    raise UnsupportedOfficialFormFormat(
        f"Unsupported official form format: {original_name} ({mime_type})"
    )
