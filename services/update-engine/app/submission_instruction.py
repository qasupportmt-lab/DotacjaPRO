import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup


def _space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _candidate_address(text: str) -> str | None:
    patterns = [
        r"((?:ul\.|al\.|aleja|pl\.|plac)\s+[A-ZĄĆĘŁŃÓŚŹŻ0-9][^\n,;]{2,100}(?:\s+\d+[A-Za-z]?)(?:\s*,?\s*\d{2}-\d{3}\s+[A-ZĄĆĘŁŃÓŚŹŻ][^\n,;]{1,80})?)",
        r"(\d{2}-\d{3}\s+[A-ZĄĆĘŁŃÓŚŹŻ][A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż -]{2,80},?\s+(?:ul\.|al\.|aleja|pl\.|plac)\s+[^\n,;]{3,100})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return _space(match.group(1))[:1000]
    return None


def _deadline_text(text: str) -> str | None:
    patterns = [
        r"((?:termin|nab[oó]r)[^.\n]{0,160}(?:\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})[^.\n]{0,100})",
        r"((?:do dnia|w dniu|od dnia)[^.\n]{0,120}(?:\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})[^.\n]{0,80})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return _space(match.group(1))[:1000]
    return None


def _signature_text(text: str) -> str | None:
    match = re.search(
        r"([^\n.]{0,120}(?:podpis|podpisan)[^\n.]{0,220})",
        text,
        flags=re.IGNORECASE,
    )
    return _space(match.group(1))[:3000] if match else None


def analyze_submission_instruction(
    html: str,
    page_url: str,
    institution_name: str,
) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)
    normalized = _space(text)
    lowered = normalized.lower()

    methods: list[str] = []

    if re.search(
        r"\b(osobiście|osobiscie|w siedzibie urzędu|w siedzibie urzedu|w kancelarii|w sekretariacie)\b",
        lowered,
    ):
        methods.append("IN_PERSON")

    if re.search(
        r"\b(pocztą|poczta|pocztową|pocztowa|listem poleconym|drogą pocztową|droga pocztowa)\b",
        lowered,
    ):
        methods.append("POSTAL")

    electronic_url = None
    for link in soup.find_all("a", href=True):
        href = urljoin(page_url, link.get("href"))
        label = _space(link.get_text(" ", strip=True)).lower()
        haystack = f"{label} {href}".lower()

        if any(token in haystack for token in (
            "praca.gov.pl",
            "epuap",
            "e-doręczenia",
            "e-doreczenia",
            "pismo ogólne",
            "pismo ogolne",
            "elektronicznie",
        )):
            if urlparse(href).scheme in {"http", "https"}:
                electronic_url = href
                if "ELECTRONIC" not in methods:
                    methods.append("ELECTRONIC")
                break

    if not methods:
        return None

    copies = None
    copy_match = re.search(
        r"(\d+)\s+(?:egzemplarz|egzemplarze|egzemplarzy)",
        lowered,
    )
    if copy_match:
        try:
            copies = int(copy_match.group(1))
        except ValueError:
            copies = None

    room = None
    room_match = re.search(
        r"(?:pok[oó]j|stanowisko)\s*(?:nr\s*)?([A-Za-z0-9/-]{1,20})",
        normalized,
        flags=re.IGNORECASE,
    )
    if room_match:
        room = room_match.group(1)

    return {
        "instruction": {
            "institutionName": institution_name,
            "methods": methods,
            "address": _candidate_address(text),
            "electronicUrl": electronic_url,
            "officeRoom": room,
            "hoursText": None,
            "deadlineText": _deadline_text(text),
            "requiredCopies": copies,
            "signatureInstructions": _signature_text(text),
            "attachmentsNote": None,
            "notes": None,
        },
        "analysis": {
            "methodsDetected": methods,
            "electronicUrlDetected": electronic_url,
            "addressDetected": _candidate_address(text),
            "deadlineDetected": _deadline_text(text),
            "conservative": True,
        },
    }
