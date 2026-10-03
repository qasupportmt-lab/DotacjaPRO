from io import BytesIO

from pypdf import PdfReader
from reportlab.pdfgen import canvas

from app.renderers.pdf import render_pdf


def make_flat_pdf() -> bytes:
    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=(300, 300))
    c.drawString(30, 270, "ORYGINALNY FORMULARZ")
    c.save()
    return stream.getvalue()


def make_acroform_pdf() -> bytes:
    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=(300, 300))
    c.drawString(30, 270, "Imie:")
    c.acroForm.textfield(
        name="applicant_name",
        x=80,
        y=250,
        width=150,
        height=20,
    )
    c.save()
    return stream.getvalue()


def test_coordinate_overlay_keeps_original_page_content():
    rendered = render_pdf(
        make_flat_pdf(),
        mappings=[
            {
                "fieldKey": "user.name",
                "locatorType": "PDF_COORDINATE",
                "locatorJson": {
                    "page": 0,
                    "x": 30,
                    "y": 230,
                    "fontSize": 10,
                },
                "sourcePath": "",
                "inputType": "TEXT",
            }
        ],
        values={"user.name": "Jan Kowalski"},
    )

    text = PdfReader(BytesIO(rendered)).pages[0].extract_text()
    assert "ORYGINALNY FORMULARZ" in text
    assert "Jan Kowalski" in text


def test_acroform_field_is_filled():
    rendered = render_pdf(
        make_acroform_pdf(),
        mappings=[
            {
                "fieldKey": "user.name",
                "locatorType": "PDF_ACROFORM",
                "locatorJson": {},
                "sourcePath": "applicant_name",
                "inputType": "TEXT",
            }
        ],
        values={"user.name": "Jan Kowalski"},
    )

    fields = PdfReader(BytesIO(rendered)).get_fields()
    assert fields["applicant_name"]["/V"] == "Jan Kowalski"
