import re
from urllib.parse import unquote, urljoin, urlparse

from bs4 import BeautifulSoup

SUPPORTED_EXTENSIONS = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".odt", ".ods")


def _looks_like_document(url: str) -> bool:
    path = unquote(urlparse(url).path).lower()
    return any(ext in path for ext in SUPPORTED_EXTENSIONS)


def discover_official_attachments(html: str, page_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    parent_host = urlparse(page_url).hostname
    found: dict[str, dict] = {}

    for link in soup.find_all("a", href=True):
        absolute = urljoin(page_url, link.get("href"))
        parsed = urlparse(absolute)

        if parsed.scheme not in ("http", "https"):
            continue
        if parsed.hostname != parent_host:
            continue
        if not _looks_like_document(absolute):
            continue

        name = re.sub(r"\s+", " ", link.get_text(" ", strip=True)).strip()
        if not name:
            name = unquote(parsed.path.rstrip("/").split("/")[-1]) or "załącznik"

        found[absolute] = {"name": name[:500], "url": absolute}

    return list(found.values())
