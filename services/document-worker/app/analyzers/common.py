import re
import unicodedata


def slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = "".join(
        char for char in normalized
        if not unicodedata.combining(char)
    )
    cleaned = re.sub(r"[^0-9A-Za-z]+", ".", ascii_value).strip(".").lower()
    return cleaned[:80] or "field"


def draft_key(prefix: str, label: str, position: str) -> str:
    return f"draft.{prefix}.{slug(label)}.{position}"
