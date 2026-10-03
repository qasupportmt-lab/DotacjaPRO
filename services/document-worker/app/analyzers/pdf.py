from io import BytesIO

from pypdf import PdfReader

from .common import draft_key


def analyze_pdf(source: bytes) -> dict:
    reader = PdfReader(BytesIO(source))
    fields = reader.get_fields() or {}
    mappings: list[dict] = []

    for index, (name, field) in enumerate(sorted(fields.items())):
        field_type = str(field.get("/FT", ""))
        input_type = {
            "/Btn": "BOOLEAN",
            "/Ch": "SELECT",
            "/Sig": "SIGNATURE",
        }.get(field_type, "TEXT")

        mappings.append({
            "fieldKey": draft_key("pdf", name, str(index)),
            "sourcePath": name,
            "locatorType": "PDF_ACROFORM",
            "locatorJson": {},
            "inputType": input_type,
            "questionLabel": name,
            "section": "Formularz PDF",
            "sortOrder": index,
            "required": False,
            "helpText": "Pole wykryte automatycznie w oryginalnym AcroForm PDF.",
        })

    return {
        "mappings": mappings,
        "analysis": {
            "format": "PDF",
            "pages": len(reader.pages),
            "acroFormFields": len(fields),
            "requiresManualCoordinateMapping": len(fields) == 0,
            "warnings": (
                ["PDF nie zawiera pól AcroForm. Wymagane ręczne mapowanie koordynatów."]
                if not fields else []
            ),
        },
    }
