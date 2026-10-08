from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_FONT_BOLD_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _register_fonts() -> tuple[str, str]:
    regular = "Helvetica"
    bold = "Helvetica-Bold"

    try:
        if "DejaVuSans" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("DejaVuSans", _FONT_PATH))
        if "DejaVuSans-Bold" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", _FONT_BOLD_PATH))
        regular = "DejaVuSans"
        bold = "DejaVuSans-Bold"
    except Exception:
        pass

    return regular, bold


def build_ebook_report(payload: dict[str, Any], manifest: dict[str, Any]) -> tuple[bytes, str]:
    regular, bold = _register_fonts()

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="doradcyPRO — raport i plan działania",
        author="doradcyPRO",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TitlePL",
        parent=styles["Title"],
        fontName=bold,
        fontSize=22,
        leading=27,
        textColor=colors.HexColor("#0E251A"),
        alignment=TA_LEFT,
        spaceAfter=10,
    )
    heading = ParagraphStyle(
        "HeadingPL",
        parent=styles["Heading2"],
        fontName=bold,
        fontSize=13,
        leading=17,
        textColor=colors.HexColor("#173A29"),
        spaceBefore=12,
        spaceAfter=7,
    )
    body = ParagraphStyle(
        "BodyPL",
        parent=styles["BodyText"],
        fontName=regular,
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor("#1B251F"),
        spaceAfter=6,
    )
    small = ParagraphStyle(
        "SmallPL",
        parent=body,
        fontSize=7.8,
        leading=11,
        textColor=colors.HexColor("#526057"),
    )

    call = payload.get("fundingCall") or {}
    instruction_record = payload.get("submissionInstruction") or {}
    instruction = instruction_record.get("instruction") or {}
    documents = manifest.get("documents") or []

    story = [
        Paragraph("doradcyPRO", small),
        Paragraph("Raport elektroniczny i plan działania", title_style),
        Paragraph(
            "Dokument porządkuje wynik przygotowania sprawy, źródła urzędowe, "
            "dokumenty oraz kolejne kroki. Nie zastępuje decyzji właściwej instytucji.",
            body,
        ),
        Spacer(1, 4 * mm),
    ]

    generated = datetime.now(timezone.utc).isoformat()
    summary_rows = [
        ["Sprawa", str(manifest.get("caseId") or "—")],
        ["Nabór", str(call.get("title") or "—")],
        ["Instytucja", str(instruction.get("institutionName") or call.get("institutionName") or "—")],
        ["Wygenerowano", generated],
    ]
    table = Table(summary_rows, colWidths=[38 * mm, 120 * mm])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), regular),
        ("FONTNAME", (0, 0), (0, -1), bold),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("LEADING", (0, 0), (-1, -1), 12),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EDF6F0")),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#C9D8CE")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(table)

    story.append(Paragraph("Co znajduje się w pakiecie", heading))
    if documents:
        for item in documents:
            story.append(
                Paragraph(
                    f"• {item.get('name') or 'Dokument'} — SHA-256: "
                    f"{item.get('sha256') or 'brak'}",
                    body,
                )
            )
    else:
        story.append(Paragraph("Brak dokumentów w manifeście.", body))

    story.append(Paragraph("Instrukcja złożenia", heading))
    methods = instruction.get("methods") or []
    if methods:
        story.append(Paragraph("Sposób: " + ", ".join(map(str, methods)), body))
    for label, key in (
        ("Adres", "address"),
        ("Miejsce / pokój", "officeRoom"),
        ("Godziny / zasady", "hoursText"),
        ("Termin", "deadlineText"),
        ("Podpisy", "signatureInstructions"),
        ("Załączniki", "attachmentsNote"),
        ("Uwagi", "notes"),
    ):
        value = instruction.get(key)
        if value:
            story.append(Paragraph(f"<b>{label}:</b> {value}", body))

    if instruction.get("electronicUrl"):
        story.append(
            Paragraph(
                f"<b>Adres elektroniczny:</b> {instruction['electronicUrl']}",
                body,
            )
        )

    story.append(Paragraph("Źródła i podstawa", heading))
    if call.get("officialUrl"):
        story.append(Paragraph(f"Oficjalne ogłoszenie: {call['officialUrl']}", body))
    if instruction_record.get("sourceUrl"):
        story.append(
            Paragraph(
                f"Źródło instrukcji: {instruction_record['sourceUrl']}",
                body,
            )
        )
    if instruction_record.get("sourceHash"):
        story.append(
            Paragraph(
                f"Hash źródła instrukcji: {instruction_record['sourceHash']}",
                small,
            )
        )
    story.append(
        Paragraph(
            "doradcyPRO korzysta z zapisanych wersji źródeł i urzędowych formularzy. "
            "Przed złożeniem sprawdź termin, podpisy i wymagane załączniki.",
            body,
        )
    )

    story.append(Paragraph("Ważne ograniczenia", heading))
    story.append(
        Paragraph(
            "Raport nie gwarantuje przyznania finansowania, określonej punktacji, "
            "przyjęcia dokumentów ani pozytywnej decyzji. Ostateczna ocena należy "
            "do właściwej instytucji. Produkt i stawka podatkowa są rozliczane "
            "zgodnie z konfiguracją produktu oraz obowiązującą klasyfikacją.",
            body,
        )
    )

    legal = manifest.get("legal") or {}
    story.append(
        Paragraph(
            f"Wersja informacji prawnej: {legal.get('version') or '—'}",
            small,
        )
    )

    doc.build(story)
    content = buffer.getvalue()
    return content, hashlib.sha256(content).hexdigest()
