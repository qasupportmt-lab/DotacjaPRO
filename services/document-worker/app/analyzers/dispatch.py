from .docx import analyze_docx
from .pdf import analyze_pdf
from .xlsx import analyze_xlsx


def analyze_official_document(
    source: bytes,
    original_name: str,
    mime_type: str,
) -> dict:
    name = original_name.lower()
    mime = (mime_type or "").lower()

    if name.endswith(".pdf") or mime == "application/pdf":
        return analyze_pdf(source)

    if (
        name.endswith(".docx")
        or mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        return analyze_docx(source)

    if (
        name.endswith(".xlsx")
        or mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ):
        return analyze_xlsx(source)

    return {
        "mappings": [],
        "analysis": {
            "format": original_name.rsplit(".", 1)[-1].upper() if "." in original_name else "UNKNOWN",
            "candidateFields": 0,
            "requiresHumanVerification": True,
            "warnings": [
                "Format zachowano jako oryginał, ale automatyczny analyzer nie obsługuje tej wersji."
            ],
        },
    }
