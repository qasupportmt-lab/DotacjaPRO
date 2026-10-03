import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

MAIN_OFFICE_RE = re.compile(r"^(Powiatowy|Miejski) Urząd Pracy\b", re.IGNORECASE)
BRANCH_RE = re.compile(
    r"^(Gminne Centrum Pracy|Oddział Zamiejscowy|Filia)\b",
    re.IGNORECASE
)
URL_RE = re.compile(r"(https?://[^\s<>]+|www\.[^\s<>]+)", re.IGNORECASE)
MUNICIPALITIES_RE = re.compile(r"obsługuje gminy:\s*(.*)", re.IGNORECASE)


def normalize_url(value: str) -> str:
    value = value.strip().rstrip(".,;)")
    if value.startswith("www."):
        value = "https://" + value
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"Invalid office URL: {value}")
    return value


def split_municipalities(value: str) -> list[str]:
    return [
        part.strip().strip(" .;")
        for part in value.split(",")
        if part.strip().strip(" .;")
    ]


def parse_pup_directory(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n")
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]

    offices: list[dict] = []
    current: dict | None = None
    collecting_municipalities = False

    def flush():
        nonlocal current
        if not current:
            return
        if current.get("officialUrl") and current.get("municipalities"):
            current["municipalities"] = sorted(set(current["municipalities"]))
            offices.append(current)
        current = None

    for line in lines:
        if MAIN_OFFICE_RE.match(line):
            flush()
            current = {
                "name": line,
                "officialUrl": None,
                "municipalities": []
            }
            collecting_municipalities = False
            continue

        if current is None:
            continue

        if BRANCH_RE.match(line):
            collecting_municipalities = False
            continue

        if current["officialUrl"] is None:
            match_url = URL_RE.search(line)
            if match_url:
                try:
                    current["officialUrl"] = normalize_url(match_url.group(1))
                except ValueError:
                    pass

        match_municipalities = MUNICIPALITIES_RE.search(line)
        if match_municipalities:
            current["municipalities"].extend(
                split_municipalities(match_municipalities.group(1))
            )
            collecting_municipalities = not bool(match_municipalities.group(1).strip())
            continue

        if collecting_municipalities:
            if (
                MAIN_OFFICE_RE.match(line)
                or BRANCH_RE.match(line)
                or re.match(r"^(Tel|Telefon|Fax|E-mail|Adres)\b", line, re.IGNORECASE)
            ):
                collecting_municipalities = False
            else:
                current["municipalities"].extend(split_municipalities(line))

    flush()
    return offices
