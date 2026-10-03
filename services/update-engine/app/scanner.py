import asyncio
import hashlib
import os
from datetime import datetime, timezone

import httpx

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:4000")
WORKER_SECRET = os.getenv("INTERNAL_WORKER_SECRET", "")
USER_AGENT = "DotacjaPRO-UpdateEngine/0.1 (+official-source-monitor)"


def worker_headers() -> dict[str, str]:
    if not WORKER_SECRET:
        raise RuntimeError("INTERNAL_WORKER_SECRET is required")
    return {"x-worker-secret": WORKER_SECRET}


async def scan_source(client: httpx.AsyncClient, source: dict) -> dict:
    request_headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if source.get("etag"):
        request_headers["If-None-Match"] = source["etag"]
    if source.get("lastModified"):
        request_headers["If-Modified-Since"] = source["lastModified"]

    response = await client.get(source["canonicalUrl"], headers=request_headers)

    if response.status_code == 304 and source.get("contentHash"):
        digest = source["contentHash"]
    else:
        response.raise_for_status()
        digest = hashlib.sha256(response.content).hexdigest()

    payload = {
        "sourceId": source["id"],
        "sha256": digest,
        "statusCode": response.status_code,
        "etag": response.headers.get("etag"),
        "lastModified": response.headers.get("last-modified"),
        "scannedAt": datetime.now(timezone.utc).isoformat()
    }

    report = await client.post(
        f"{API_BASE_URL}/v1/internal/source-scan",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json=payload
    )
    report.raise_for_status()
    result = report.json()
    return {
        "sourceId": source["id"],
        "url": source["canonicalUrl"],
        "httpStatus": response.status_code,
        **result
    }


async def scan_all_sources() -> dict:
    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        response = await client.get(
            f"{API_BASE_URL}/v1/internal/sources",
            headers=worker_headers()
        )
        response.raise_for_status()
        sources = response.json()["sources"]

        semaphore = asyncio.Semaphore(6)

        async def guarded(source: dict):
            async with semaphore:
                try:
                    return await scan_source(client, source)
                except Exception as exc:
                    return {
                        "sourceId": source["id"],
                        "url": source["canonicalUrl"],
                        "error": str(exc)
                    }

        results = await asyncio.gather(*(guarded(source) for source in sources))
        changed = [item for item in results if item.get("changed")]
        errors = [item for item in results if item.get("error")]

        return {
            "scanned": len(results),
            "changed": len(changed),
            "errors": len(errors),
            "results": results
        }


async def build_morning_digests() -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{API_BASE_URL}/v1/internal/build-digests",
            headers=worker_headers()
        )
        response.raise_for_status()
        return response.json()
