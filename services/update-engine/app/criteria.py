import re
from io import BytesIO

from pypdf import PdfReader


MAX_POINTS_RE = re.compile(
    r"(?:maksymalnie|max\.?)[\s:]*(\d+(?:[.,]\d+)?)\s*pkt(?:\.?|\b)\s*[-–—:]?\s*(.+?)(?=(?:maksymalnie|max\.?)[\s:]*(?:\d)|$)",
    flags=re.IGNORECASE | re.DOTALL,
)

MIN_POINTS_PATTERNS = [
    re.compile(
        r"(?:nie\s+niższ\w*\s+niż|co\s+najmniej|min(?:imum)?\.?)[^\d]{0,80}(\d+(?:[.,]\d+)?)\s*punkt",
        flags=re.IGNORECASE,
    ),
    re.compile(
        r"(\d+(?:[.,]\d+)?)\s*punkt(?:ów|y)?[^.]{0,100}(?:minimum|warunek|próg)",
        flags=re.IGNORECASE,
    ),
]

BLOCKING_RE = re.compile(
    r"((?:nie\s+uzyskanie|nieuzyskanie|uzyskanie\s+0\s+pkt)[^.]{0,500}(?:odstąp|odrzuc|nie\s+podlega|nie\s+będzie)[^.]{0,400}\.)",
    flags=re.IGNORECASE,
)

NUMBERED_CRITERION_RE = re.compile(
    r"(?:kryter(?:ium|iach?|iów)\s*)?((?:\d+\s*(?:,|i|oraz|-)\s*)+\d+|\d+)",
    flags=re.IGNORECASE,
)


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" \n\t-–—:;.")


def _number(value: str) -> float:
    return float(value.replace(",", "."))


def extract_pdf_text(source: bytes) -> tuple[str, int]:
    reader = PdfReader(BytesIO(source))
    parts: list[str] = []

    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            parts.append("")

    return "\n".join(parts), len(reader.pages)


def analyze_criteria_text(text: str, title: str = "Kryteria oceny") -> dict:
    normalized = re.sub(r"[ \t]+", " ", text)
    normalized = re.sub(r"\n{2,}", "\n", normalized)

    criteria: list[dict] = []
    seen_titles: set[str] = set()

    for index, match in enumerate(MAX_POINTS_RE.finditer(normalized)):
        max_points = _number(match.group(1))
        raw_title = _clean(match.group(2))
        raw_title = re.split(
            r"(?=\b\d+(?:[.,]\d+)?\s*pkt\s*[-–—:])",
            raw_title,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        criterion_title = _clean(raw_title)[:700]

        if not criterion_title or criterion_title.lower() in seen_titles:
            continue
        seen_titles.add(criterion_title.lower())

        criteria.append({
            "code": f"AUTO-{len(criteria) + 1:03d}",
            "title": criterion_title,
            "maxPoints": max_points,
            "failIfZero": False,
            "scoringJson": {
                "type": "AUTO_EXTRACTED_MAX_POINTS",
                "rawMatch": _clean(match.group(0))[:2500],
            },
            "evidenceHint": "Automatycznie wykryte z oficjalnego dokumentu. Wymaga kontroli przed VERIFIED.",
            "sortOrder": len(criteria),
        })

    minimum_points = None
    minimum_evidence = None
    for pattern in MIN_POINTS_PATTERNS:
        match = pattern.search(normalized)
        if match:
            minimum_points = _number(match.group(1))
            minimum_evidence = _clean(match.group(0))[:1500]
            break

    blocking_rules = []
    for match in BLOCKING_RE.finditer(normalized):
        sentence = _clean(match.group(1))
        candidate_numbers = []
        number_match = NUMBERED_CRITERION_RE.search(sentence)
        if number_match:
            candidate_numbers = [
                int(value)
                for value in re.findall(r"\d+", number_match.group(1))
                if int(value) <= max(300, len(criteria) + 10)
            ]

        blocking_rules.append({
            "type": "AUTO_EXTRACTED_BLOCKING_RULE",
            "rawText": sentence[:3000],
            "candidateCriterionNumbers": candidate_numbers,
            "requiresVerification": True,
        })

    maximum_points = (
        sum(float(item["maxPoints"]) for item in criteria)
        if criteria
        else None
    )

    return {
        "title": title,
        "minimumPoints": minimum_points,
        "maximumPoints": maximum_points,
        "blockingRulesJson": {
            "rules": blocking_rules,
            "minimumPointsEvidence": minimum_evidence,
            "requiresVerification": True,
        },
        "criteria": criteria,
        "analysisJson": {
            "format": "TEXT",
            "candidateCriteria": len(criteria),
            "minimumPointsCandidate": minimum_points,
            "maximumPointsCalculated": maximum_points,
            "blockingRuleCandidates": len(blocking_rules),
            "warnings": [
                "Wynik jest propozycją techniczną DRAFT.",
                "Punktacja, progi i reguły blokujące wymagają ręcznej kontroli z oficjalnym dokumentem przed VERIFIED.",
            ],
        },
    }


def analyze_criteria_document(
    source: bytes,
    original_name: str,
    mime_type: str,
) -> dict:
    name = original_name.lower()
    mime = (mime_type or "").lower()

    if not (name.endswith(".pdf") or mime == "application/pdf"):
        return {
            "title": original_name,
            "minimumPoints": None,
            "maximumPoints": None,
            "blockingRulesJson": {
                "rules": [],
                "requiresVerification": True,
            },
            "criteria": [],
            "analysisJson": {
                "format": name.rsplit(".", 1)[-1].upper() if "." in name else "UNKNOWN",
                "candidateCriteria": 0,
                "warnings": [
                    "Automatyczna analiza kryteriów obsługuje obecnie PDF; dokument zachowano jako oryginał do ręcznej weryfikacji."
                ],
            },
        }

    text, pages = extract_pdf_text(source)
    result = analyze_criteria_text(text, original_name)
    result["analysisJson"]["format"] = "PDF"
    result["analysisJson"]["pages"] = pages
    result["analysisJson"]["extractedCharacters"] = len(text)
    if len(text.strip()) < 100:
        result["analysisJson"]["warnings"].append(
            "PDF zawiera bardzo mało tekstu ekstraktowalnego; możliwy skan lub układ wymagający ręcznej kontroli."
        )
    return result
