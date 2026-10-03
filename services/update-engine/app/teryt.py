import csv
import io
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Iterable

import httpx

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:4000")
WORKER_SECRET = os.getenv("INTERNAL_WORKER_SECRET", "")

MUNICIPALITY_TYPES = {"1", "2", "3", "8", "9"}


def worker_headers() -> dict[str, str]:
    if not WORKER_SECRET:
        raise RuntimeError("INTERNAL_WORKER_SECRET is required")
    return {"x-worker-secret": WORKER_SECRET}


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1250", "iso-8859-2"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _normalize_row(row: dict[str, str | None]) -> dict[str, str]:
    return {
        str(key).strip().upper(): (value or "").strip()
        for key, value in row.items()
        if key is not None
    }


def _csv_rows(data: bytes) -> list[dict[str, str]]:
    text = _decode(data)
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,|	,")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ";"

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    return [_normalize_row(row) for row in reader]


def _xml_rows(data: bytes) -> list[dict[str, str]]:
    root = ET.fromstring(data)
    rows: list[dict[str, str]] = []

    for element in root.iter():
        children = list(element)
        if not children:
            continue

        row = {
            child.tag.split("}")[-1].strip().upper(): (child.text or "").strip()
            for child in children
        }

        if "WOJ" in row and ("NAZWA" in row or "SYM" in row):
            rows.append(row)

    return rows


def parse_rows(data: bytes, content_type: str | None = None) -> list[dict[str, str]]:
    stripped = data.lstrip()
    if (
        (content_type and "xml" in content_type.lower())
        or stripped.startswith(b"<?xml")
        or stripped.startswith(b"<")
    ):
        return _xml_rows(data)
    return _csv_rows(data)


def _terc_code(woj: str, pow_: str, gmi: str, rodz: str) -> str:
    return f"{woj}{pow_}{gmi}{rodz}"


def parse_terc(data: bytes, content_type: str | None = None) -> list[dict]:
    rows = parse_rows(data, content_type)
    voivodeships: dict[str, str] = {}
    counties: dict[tuple[str, str], str] = {}

    for row in rows:
        woj = row.get("WOJ", "")
        pow_ = row.get("POW", "")
        gmi = row.get("GMI", "")
        name = row.get("NAZWA", "")

        if woj and not pow_ and not gmi and name:
            voivodeships[woj] = name.lower()
        elif woj and pow_ and not gmi and name:
            counties[(woj, pow_)] = name

    municipalities: list[dict] = []
    seen: set[str] = set()

    for row in rows:
        woj = row.get("WOJ", "")
        pow_ = row.get("POW", "")
        gmi = row.get("GMI", "")
        rodz = row.get("RODZ", "")
        name = row.get("NAZWA", "")
        unit_type = row.get("NAZDOD", "")
        state_date = row.get("STAN_NA", "")

        if not (woj and pow_ and gmi and rodz and name):
            continue
        if rodz not in MUNICIPALITY_TYPES:
            continue

        code = _terc_code(woj, pow_, gmi, rodz)
        if code in seen:
            continue
        seen.add(code)

        municipalities.append({
            "tercCode": code,
            "voivodeshipCode": woj,
            "voivodeship": voivodeships.get(woj, ""),
            "countyCode": pow_,
            "county": counties.get((woj, pow_), ""),
            "municipalityCode": gmi,
            "municipality": name,
            "municipalityTypeCode": rodz,
            "municipalityType": unit_type or None,
            "validFrom": state_date or None,
            "validTo": None,
        })

    return municipalities


def parse_simc(
    data: bytes,
    known_terc_codes: set[str],
    content_type: str | None = None,
) -> list[dict]:
    rows = parse_rows(data, content_type)
    localities: list[dict] = []
    seen: set[str] = set()

    for row in rows:
        woj = row.get("WOJ", "")
        pow_ = row.get("POW", "")
        gmi = row.get("GMI", "")
        rodz = row.get("RODZ_GMI", "")
        simc = row.get("SYM", "")
        name = row.get("NAZWA", "")
        locality_type = row.get("RM", "")

        if not (woj and pow_ and gmi and rodz and simc and name):
            continue

        direct_code = _terc_code(woj, pow_, gmi, rodz)
        parent_code = direct_code

        # W gminie miejsko-wiejskiej SIMC może wskazywać część miejską (4)
        # lub wiejską (5). Dla kwalifikacji dotacyjnej wiążemy miejscowość
        # z nadrzędną gminą miejsko-wiejską (3), jeżeli istnieje w TERC.
        if rodz in {"4", "5"}:
            candidate = _terc_code(woj, pow_, gmi, "3")
            if candidate in known_terc_codes:
                parent_code = candidate

        if parent_code not in known_terc_codes:
            continue
        if simc in seen:
            continue
        seen.add(simc)

        localities.append({
            "simcCode": simc,
            "name": name,
            "localityType": locality_type or None,
            "municipalityTercCode": parent_code,
        })

    return localities


def chunked(items: list[dict], size: int) -> Iterable[list[dict]]:
    for index in range(0, len(items), size):
        yield items[index:index + size]


async def send_import(
    client: httpx.AsyncClient,
    municipalities: list[dict],
    localities: list[dict],
    source_version: str,
) -> dict:
    response = await client.post(
        f"{API_BASE_URL}/v1/internal/teryt/import",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json={
            "sourceVersion": source_version,
            "municipalities": municipalities,
            "localities": localities,
        },
    )
    response.raise_for_status()
    return response.json()


async def sync_teryt_from_urls() -> dict:
    terc_url = os.getenv("TERYT_TERC_FULL_URL")
    simc_url = os.getenv("TERYT_SIMC_FULL_URL")

    if not terc_url or not simc_url:
        return {
            "configured": False,
            "skipped": True,
            "reason": "TERYT_TERC_FULL_URL and TERYT_SIMC_FULL_URL are required",
        }

    timeout = httpx.Timeout(90.0, connect=15.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        terc_response, simc_response = await __import__("asyncio").gather(
            client.get(terc_url),
            client.get(simc_url),
        )
        terc_response.raise_for_status()
        simc_response.raise_for_status()

        municipalities = parse_terc(
            terc_response.content,
            terc_response.headers.get("content-type"),
        )
        known_codes = {item["tercCode"] for item in municipalities}
        localities = parse_simc(
            simc_response.content,
            known_codes,
            simc_response.headers.get("content-type"),
        )

        source_version = (
            terc_response.headers.get("last-modified")
            or simc_response.headers.get("last-modified")
            or datetime.now(timezone.utc).date().isoformat()
        )

        totals = {
            "municipalitiesUpserted": 0,
            "localitiesUpserted": 0,
        }

        # Najpierw gminy, potem miejscowości. Dzięki temu klucze SIMC
        # zawsze wskazują na istniejący rekord TERC.
        first = await send_import(
            client,
            municipalities=municipalities,
            localities=[],
            source_version=source_version,
        )
        totals["municipalitiesUpserted"] += first["municipalitiesUpserted"]

        for batch in chunked(localities, 5000):
            result = await send_import(
                client,
                municipalities=[],
                localities=batch,
                source_version=source_version,
            )
            totals["localitiesUpserted"] += result["localitiesUpserted"]

        return {
            "configured": True,
            "skipped": False,
            "sourceVersion": source_version,
            "parsedMunicipalities": len(municipalities),
            "parsedLocalities": len(localities),
            **totals,
        }
