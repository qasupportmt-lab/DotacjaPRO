import json
from typing import Any


def as_text(value: Any, input_type: str | None = None) -> str:
    if value is None:
        return ""

    if isinstance(value, bool):
        if input_type == "BOOLEAN":
            return "TAK" if value else "NIE"
        return "true" if value else "false"

    if isinstance(value, (int, float, str)):
        return str(value)

    if isinstance(value, list):
        return ", ".join(as_text(item) for item in value)

    if isinstance(value, dict):
        if "label" in value and isinstance(value["label"], str):
            return value["label"]
        if "value" in value and isinstance(value["value"], (str, int, float, bool)):
            return as_text(value["value"], input_type)
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    return str(value)
