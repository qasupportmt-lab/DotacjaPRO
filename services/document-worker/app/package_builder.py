import hashlib
import html
import json
import re
import zipfile
from io import BytesIO
from typing import Any

from .storage import get_bytes


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-zÀ-ž._() -]+", "_", value).strip()
    return cleaned[:180] or "dokument"


def _instruction_lines(payload: dict[str, Any]) -> list[str]:
    call = payload["fundingCall"]
    verified = payload["submissionInstruction"]
    instruction = verified["instruction"] or {}

    methods = instruction.get("methods") or []
    method_labels = {
        "IN_PERSON": "Osobiście",
        "POSTAL": "Pocztą",
        "ELECTRONIC": "Elektronicznie",
    }

    lines = [
        "DOTACJAPRO — INSTRUKCJA ZŁOŻENIA DOKUMENTÓW",
        "",
        f"Nabór: {call.get('title') or ''}",
        f"Instytucja: {instruction.get('institutionName') or call.get('institutionName') or ''}",
    ]

    if call.get("officialUrl"):
        lines.append(f"Oficjalne ogłoszenie: {call['officialUrl']}")

    if verified.get("sourceUrl"):
        lines.append(f"Źródło instrukcji: {verified['sourceUrl']}")

    lines.extend([
        f"Wersja instrukcji: {verified.get('version')}",
        f"Zweryfikowano: {verified.get('verifiedAt') or ''}",
        "",
        "SPOSÓB ZŁOŻENIA",
    ])

    if methods:
        lines.append(
            ", ".join(method_labels.get(method, method) for method in methods)
        )

    if instruction.get("address"):
        lines.append(f"Adres: {instruction['address']}")
    if instruction.get("officeRoom"):
        lines.append(f"Pokój / stanowisko: {instruction['officeRoom']}")
    if instruction.get("hoursText"):
        lines.append(f"Godziny / zasady przyjęć: {instruction['hoursText']}")
    if instruction.get("electronicUrl"):
        lines.append(f"Adres elektroniczny: {instruction['electronicUrl']}")
    if instruction.get("deadlineText"):
        lines.append(f"Termin: {instruction['deadlineText']}")
    if instruction.get("requiredCopies"):
        lines.append(f"Liczba egzemplarzy: {instruction['requiredCopies']}")
    if instruction.get("signatureInstructions"):
        lines.append(f"Podpisy: {instruction['signatureInstructions']}")
    if instruction.get("attachmentsNote"):
        lines.append(f"Załączniki: {instruction['attachmentsNote']}")
    if instruction.get("notes"):
        lines.append(f"Uwagi: {instruction['notes']}")

    lines.extend([
        "",
        "PRZED ZŁOŻENIEM",
        "1. Wydrukuj dokumenty, jeżeli dany tryb złożenia wymaga wersji papierowej.",
        "2. Sprawdź miejsca podpisu i podpisz dokumenty zgodnie z instrukcją urzędu.",
        "3. Dołącz wymagane załączniki wskazane w ogłoszeniu i formularzach.",
        "4. Nie zmieniaj układu ani treści urzędowych formularzy.",
        "5. Zachowaj kopię złożonego kompletu oraz potwierdzenie złożenia.",
        "",
        "DotacjaPRO przygotowuje dokumenty na zarejestrowanych wersjach urzędowych.",
        "Ostateczną decyzję o przyjęciu i ocenie wniosku podejmuje właściwa instytucja.",
    ])

    return lines


def build_package(payload: dict[str, Any]) -> tuple[bytes, str, str]:
    case_id = payload["job"]["caseId"]
    documents = payload.get("documents") or []
    if not documents:
        raise RuntimeError("PACKAGE_HAS_NO_DOCUMENTS")

    instruction_lines = _instruction_lines(payload)
    instruction_txt = "\n".join(instruction_lines) + "\n"

    instruction_html = """<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<title>DotacjaPRO — instrukcja złożenia</title>
<style>
body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;line-height:1.45;color:#111}
h1{font-size:24px}h2{font-size:18px;margin-top:28px}
pre{white-space:pre-wrap;font-family:Arial,sans-serif}
.footer{margin-top:36px;font-size:12px;color:#555}
@media print{body{margin:0;max-width:none}.no-print{display:none}}
</style>
</head>
<body>
<h1>DotacjaPRO — instrukcja złożenia dokumentów</h1>
<pre>""" + html.escape(instruction_txt) + """</pre>
<div class="footer">Dokument wygenerowany na podstawie zweryfikowanej instrukcji przypisanej do wybranego naboru.</div>
</body></html>"""

    manifest = {
        "caseId": case_id,
        "fundingCall": payload["fundingCall"],
        "submissionInstruction": {
            "id": payload["submissionInstruction"]["id"],
            "version": payload["submissionInstruction"]["version"],
            "sourceUrl": payload["submissionInstruction"]["sourceUrl"],
            "sourceHash": payload["submissionInstruction"].get("sourceHash"),
            "verifiedAt": payload["submissionInstruction"]["verifiedAt"],
        },
        "documents": [],
    }

    buffer = BytesIO()
    with zipfile.ZipFile(
        buffer,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        used_names: set[str] = set()

        for index, document in enumerate(documents, start=1):
            content = get_bytes(document["storageKey"])
            digest = hashlib.sha256(content).hexdigest()

            expected = document.get("outputSha256")
            if expected and digest != expected:
                raise RuntimeError(
                    f"PACKAGE_DOCUMENT_HASH_MISMATCH:{document.get('renderJobId')}"
                )

            base_name = _safe_name(
                document.get("outputName")
                or f"dokument-{index}"
            )
            name = base_name
            counter = 2
            while name in used_names:
                if "." in base_name:
                    stem, ext = base_name.rsplit(".", 1)
                    name = f"{stem}-{counter}.{ext}"
                else:
                    name = f"{base_name}-{counter}"
                counter += 1
            used_names.add(name)

            archive.writestr(f"01_dokumenty/{name}", content)
            manifest["documents"].append({
                "name": name,
                "formCode": document.get("formCode"),
                "renderJobId": document.get("renderJobId"),
                "sha256": digest,
                "sourceSha256": document.get("sourceSha256"),
                "mimeType": document.get("mimeType"),
            })

        archive.writestr(
            "00_INSTRUKCJA_ZLOZENIA.html",
            instruction_html.encode("utf-8"),
        )
        archive.writestr(
            "00_INSTRUKCJA_ZLOZENIA.txt",
            instruction_txt.encode("utf-8"),
        )
        archive.writestr(
            "99_MANIFEST.json",
            json.dumps(
                manifest,
                ensure_ascii=False,
                indent=2,
                default=str,
            ).encode("utf-8"),
        )

    content = buffer.getvalue()
    digest = hashlib.sha256(content).hexdigest()
    name = f"DotacjaPRO-sprawa-{_safe_name(case_id)}.zip"
    return content, digest, name
