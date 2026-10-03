import re
from datetime import datetime, time
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

WARSAW = ZoneInfo("Europe/Warsaw")
DATE_RE = r"(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})"


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _parse_numeric_date(value: str) -> datetime | None:
    cleaned = value.strip().replace("/", ".").replace("-", ".")
    try:
        day, month, year = [int(part) for part in cleaned.split(".")]
        return datetime(year, month, day, tzinfo=WARSAW)
    except (ValueError, TypeError):
        return None


def _day_start(value: datetime) -> datetime:
    return datetime.combine(value.date(), time.min, tzinfo=WARSAW)


def _day_end(value: datetime) -> datetime:
    return datetime.combine(value.date(), time(23, 59, 59), tzinfo=WARSAW)


def _title(soup: BeautifulSoup) -> str:
    heading = soup.find("h1")
    if heading:
        value = _normalize_space(heading.get_text(" ", strip=True))
        if value:
            return value

    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        return _normalize_space(str(og.get("content")))

    if soup.title:
        return _normalize_space(soup.title.get_text(" ", strip=True))

    return "Nabór finansowania"


def _date_evidence(text: str) -> dict:
    lowered = text.lower()

    range_match = re.search(
        rf"(?:od\s+)?{DATE_RE}\s*(?:r\.?\s*)?(?:do|[-–—])\s*{DATE_RE}",
        lowered,
        flags=re.IGNORECASE,
    )
    if range_match:
        start = _parse_numeric_date(range_match.group(1))
        end = _parse_numeric_date(range_match.group(2))
        if start and end:
            return {
                "opensAt": _day_start(start),
                "closesAt": _day_end(end),
                "matched": range_match.group(0),
            }

    single_patterns = [
        rf"termin\s+naboru[^\n.]{{0,120}}?(?:w\s+dniu\s+)?{DATE_RE}",
        rf"nab[oó]r[^\n.]{{0,120}}?w\s+dniu\s+{DATE_RE}",
        rf"w\s+dniu\s+{DATE_RE}",
    ]

    for pattern in single_patterns:
        match = re.search(pattern, lowered, flags=re.IGNORECASE)
        if not match:
            continue
        date_value = match.group(match.lastindex or 1)
        parsed = _parse_numeric_date(date_value)
        if parsed:
            return {
                "opensAt": _day_start(parsed),
                "closesAt": _day_end(parsed),
                "matched": match.group(0),
            }

    return {
        "opensAt": None,
        "closesAt": None,
        "matched": None,
    }


def analyze_funding_call_page(html: str, page_url: str, now: datetime | None = None) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    title = _title(soup)
    text = _normalize_space(soup.get_text("\n", strip=True))
    lowered = text.lower()

    dates = _date_evidence(text)
    opens_at = dates["opensAt"]
    closes_at = dates["closesAt"]

    if now is None:
        now = datetime.now(WARSAW)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=WARSAW)
    else:
        now = now.astimezone(WARSAW)

    status = "DISCOVERED"
    if "nabór zakończony" in lowered or "nabór został zakończony" in lowered:
        status = "CLOSED"
    elif opens_at and closes_at:
        if now < opens_at:
            status = "ANNOUNCED"
        elif opens_at <= now <= closes_at:
            status = "OPEN"
        elif now > closes_at:
            status = "CLOSED"

    program_match = re.search(r"\bFESL[.]\d{2}[.]\d{2}\b", text, flags=re.IGNORECASE)
    program_code = program_match.group(0).upper() if program_match else None

    until_exhausted = bool(
        re.search(
            r"do\s+(?:momentu\s+)?wyczerpania\s+(?:limitu\s+)?(?:środków|srodkow)",
            lowered,
            flags=re.IGNORECASE,
        )
    )

    return {
        "title": title[:700],
        "officialUrl": page_url,
        "programCode": program_code,
        "candidateStatus": status,
        "opensAt": opens_at.isoformat() if opens_at else None,
        "closesAt": closes_at.isoformat() if closes_at else None,
        "untilExhausted": until_exhausted,
        "evidence": {
            "dateMatch": dates["matched"],
            "programCode": program_code,
            "untilExhausted": until_exhausted,
            "textSample": text[:3000],
        },
    }


def discover_call_pages(html: str, page_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    host = urlparse(page_url).hostname
    found: dict[str, dict] = {}

    for link in soup.find_all("a", href=True):
        absolute = urljoin(page_url, link.get("href"))
        parsed = urlparse(absolute)

        if parsed.scheme not in {"http", "https"}:
            continue
        if parsed.hostname != host:
            continue

        label = _normalize_space(link.get_text(" ", strip=True))
        haystack = f"{label} {absolute}".lower()

        if not (
            "nabór" in haystack
            or "nabor" in haystack
            or "dofinansowanie" in haystack
        ):
            continue

        if any(
            noise in haystack
            for noise in (
                "prace interwencyjne",
                "staż",
                "staz",
                "szkoleni",
                "bon na zasiedlenie",
            )
        ):
            continue

        found[absolute] = {
            "name": (label or "Strona naboru")[:500],
            "url": absolute,
        }

        if len(found) >= 50:
            break

    return list(found.values())
