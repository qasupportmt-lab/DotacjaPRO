import asyncio
import hashlib
import os
from datetime import datetime, timezone

import httpx

from .criteria import analyze_criteria_document
from .funding_call import analyze_funding_call_page, discover_call_pages
from .official_attachments import discover_official_attachments
from .pup_directory import parse_pup_directory
from .storage import put_official_document
from .submission_instruction import analyze_submission_instruction

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:4000")
WORKER_SECRET = os.getenv("INTERNAL_WORKER_SECRET", "")
USER_AGENT = "DotacjaPRO-UpdateEngine/0.1 (+official-source-monitor)"

BINARY_SOURCE_KINDS = {
    "OFFICIAL_FORM",
    "OFFICIAL_ATTACHMENT",
    "REGULATION",
    "CRITERIA",
}


def worker_headers() -> dict[str, str]:
    if not WORKER_SECRET:
        raise RuntimeError("INTERNAL_WORKER_SECRET is required")
    return {"x-worker-secret": WORKER_SECRET}




async def upsert_criteria_draft(
    client: httpx.AsyncClient,
    source: dict,
    response: httpx.Response,
    archived_document: dict,
) -> dict:
    proposal = analyze_criteria_document(
        source=response.content,
        original_name=source.get("displayName")
        or source["canonicalUrl"].rstrip("/").split("/")[-1]
        or "kryteria.pdf",
        mime_type=response.headers.get("content-type", "application/octet-stream")
        .split(";")[0]
        .strip(),
    )

    payload = {
        "sourceDocumentId": archived_document["documentId"],
        "title": proposal["title"],
        "blockingRulesJson": proposal["blockingRulesJson"],
        "analysisJson": proposal["analysisJson"],
        "criteria": proposal["criteria"],
    }

    if proposal.get("minimumPoints") is not None:
        payload["minimumPoints"] = proposal["minimumPoints"]
    if proposal.get("maximumPoints") is not None:
        payload["maximumPoints"] = proposal["maximumPoints"]

    result = await client.post(
        f"{API_BASE_URL}/v1/internal/criterion-sets/upsert-draft",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json=payload,
    )
    result.raise_for_status()
    return result.json()


async def import_call_pages(
    client: httpx.AsyncClient,
    source: dict,
    html: str,
) -> list[dict]:
    pages = discover_call_pages(html, source["canonicalUrl"])
    if not pages:
        return []

    response = await client.post(
        f"{API_BASE_URL}/v1/internal/call-pages/import",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json={
            "parentSourceId": source["id"],
            "pages": pages,
        },
    )
    response.raise_for_status()
    return response.json().get("imported", [])


async def upsert_funding_call_draft(
    client: httpx.AsyncClient,
    source: dict,
    html: str,
) -> dict:
    candidate = analyze_funding_call_page(
        html,
        source["canonicalUrl"],
    )

    payload = {
        "sourceId": source["id"],
        "title": candidate["title"],
        "officialUrl": candidate["officialUrl"],
        "candidateStatus": candidate["candidateStatus"],
        "untilExhausted": candidate["untilExhausted"],
        "evidence": candidate["evidence"],
    }

    if candidate.get("programCode"):
        payload["programCode"] = candidate["programCode"]
    if candidate.get("opensAt"):
        payload["opensAt"] = candidate["opensAt"]
    if candidate.get("closesAt"):
        payload["closesAt"] = candidate["closesAt"]

    response = await client.post(
        f"{API_BASE_URL}/v1/internal/funding-calls/upsert-draft",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json=payload,
    )
    response.raise_for_status()
    return response.json()



async def upsert_submission_instruction_draft(
    client: httpx.AsyncClient,
    source: dict,
    html: str,
    funding_call_id: str,
    source_hash: str,
) -> dict | None:
    institution = source.get("institution") or {}
    institution_name = institution.get("name") or "Właściwa instytucja"

    candidate = analyze_submission_instruction(
        html,
        source["canonicalUrl"],
        institution_name,
    )

    if not candidate:
        return None

    response = await client.post(
        f"{API_BASE_URL}/v1/internal/submission-instructions/upsert-draft",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json={
            "fundingCallId": funding_call_id,
            "instruction": candidate["instruction"],
            "sourceUrl": source["canonicalUrl"],
            "sourceHash": source_hash,
        },
    )
    response.raise_for_status()
    return response.json()


async def import_source_attachments(
    client: httpx.AsyncClient,
    source: dict,
    html: str,
) -> list[dict]:
    attachments = discover_official_attachments(
        html,
        source["canonicalUrl"],
    )
    if not attachments:
        return []

    response = await client.post(
        f"{API_BASE_URL}/v1/internal/source-attachments/import",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json={
            "parentSourceId": source["id"],
            "attachments": attachments,
        },
    )
    response.raise_for_status()
    return response.json().get("imported", [])


async def archive_source_document(
    client: httpx.AsyncClient,
    source: dict,
    response: httpx.Response,
    sha256: str,
) -> dict:
    mime_type = (
        response.headers.get("content-type", "application/octet-stream")
        .split(";")[0]
        .strip()
    )
    original_name = (
        source.get("displayName")
        or source["canonicalUrl"].rstrip("/").split("/")[-1]
        or "document"
    )

    storage_key = put_official_document(
        source_id=source["id"],
        sha256=sha256,
        original_name=original_name,
        source_url=source["canonicalUrl"],
        content=response.content,
        mime_type=mime_type,
    )

    register = await client.post(
        f"{API_BASE_URL}/v1/internal/source-document",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json={
            "sourceId": source["id"],
            "originalName": original_name,
            "mimeType": mime_type,
            "sha256": sha256,
            "storageKey": storage_key,
            "downloadedAt": datetime.now(timezone.utc).isoformat(),
        },
    )
    register.raise_for_status()
    return register.json()


async def import_pup_directory(
    client: httpx.AsyncClient,
    source: dict,
    html: str,
) -> dict:
    voivodeship = source.get("scopeVoivodeship")
    if not voivodeship:
        raise RuntimeError("PUP_DIRECTORY source requires scopeVoivodeship")

    offices = parse_pup_directory(html)
    if not offices:
        raise RuntimeError("No PUP offices parsed from official directory")

    response = await client.post(
        f"{API_BASE_URL}/v1/internal/pup-directory/import",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json={
            "sourceUrl": source["canonicalUrl"],
            "voivodeship": voivodeship,
            "offices": offices,
        },
    )
    response.raise_for_status()
    return response.json()


async def scan_source(client: httpx.AsyncClient, source: dict) -> dict:
    request_headers = {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
    }
    if source.get("etag"):
        request_headers["If-None-Match"] = source["etag"]
    if source.get("lastModified"):
        request_headers["If-Modified-Since"] = source["lastModified"]

    response = await client.get(
        source["canonicalUrl"],
        headers=request_headers,
    )

    if response.status_code == 304 and source.get("contentHash"):
        digest = source["contentHash"]
    else:
        response.raise_for_status()
        digest = hashlib.sha256(response.content).hexdigest()

    report = await client.post(
        f"{API_BASE_URL}/v1/internal/source-scan",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json={
            "sourceId": source["id"],
            "sha256": digest,
            "statusCode": response.status_code,
            "etag": response.headers.get("etag"),
            "lastModified": response.headers.get("last-modified"),
            "scannedAt": datetime.now(timezone.utc).isoformat(),
        },
    )
    report.raise_for_status()
    result = report.json()

    directory_import = None
    if (
        source.get("kind") == "PUP_DIRECTORY"
        and response.status_code != 304
    ):
        directory_import = await import_pup_directory(
            client,
            source,
            response.text,
        )

    discovered_call_pages: list[dict] = []
    if (
        source.get("kind") == "PUP_HOME"
        and response.status_code != 304
    ):
        discovered_call_pages = await import_call_pages(
            client,
            source,
            response.text,
        )

    funding_call_draft = None
    submission_instruction_draft = None
    if (
        source.get("kind") in {"PUP_CALL_PAGE", "FUNDING_CALL_PAGE"}
        and response.status_code != 304
    ):
        funding_call_draft = await upsert_funding_call_draft(
            client,
            source,
            response.text,
        )

        funding_call = (
            funding_call_draft.get("call")
            if isinstance(funding_call_draft, dict)
            else None
        )
        funding_call_id = (
            funding_call.get("id")
            if isinstance(funding_call, dict)
            else None
        )

        if funding_call_id:
            submission_instruction_draft = await upsert_submission_instruction_draft(
                client,
                source,
                response.text,
                funding_call_id,
                digest,
            )

    discovered_attachments: list[dict] = []
    attachment_scans: list[dict] = []

    if (
        source.get("kind") in {"PUP_CALL_PAGE", "FUNDING_CALL_PAGE"}
        and response.status_code != 304
    ):
        discovered_attachments = await import_source_attachments(
            client,
            source,
            response.text,
        )

        for child in discovered_attachments:
            child_source = {
                "id": child["id"],
                "kind": child["kind"],
                "canonicalUrl": child["url"],
                "displayName": child.get("name"),
                "etag": None,
                "lastModified": None,
                "contentHash": None,
            }
            attachment_scans.append(
                await scan_source(client, child_source)
            )

    archived_document = None
    if (
        source.get("kind") in BINARY_SOURCE_KINDS
        and response.status_code != 304
        and (result.get("baselineCreated") or result.get("changed"))
    ):
        archived_document = await archive_source_document(
            client,
            source,
            response,
            digest,
        )

    criteria_draft = None
    if (
        source.get("kind") == "CRITERIA"
        and archived_document is not None
        and response.status_code != 304
    ):
        criteria_draft = await upsert_criteria_draft(
            client,
            source,
            response,
            archived_document,
        )

    return {
        "sourceId": source["id"],
        "url": source["canonicalUrl"],
        "httpStatus": response.status_code,
        "directoryImport": directory_import,
        "discoveredCallPages": len(discovered_call_pages),
        "fundingCallDraft": funding_call_draft,
        "submissionInstructionDraft": submission_instruction_draft,
        "discoveredAttachments": len(discovered_attachments),
        "attachmentScans": attachment_scans,
        "archivedDocument": archived_document,
        "criteriaDraft": criteria_draft,
        **result,
    }


async def scan_all_sources() -> dict:
    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
    ) as client:
        response = await client.get(
            f"{API_BASE_URL}/v1/internal/sources",
            headers=worker_headers(),
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
                        "error": str(exc),
                    }

        results = await asyncio.gather(
            *(guarded(source) for source in sources)
        )
        changed = [item for item in results if item.get("changed")]
        errors = [item for item in results if item.get("error")]

        return {
            "scanned": len(results),
            "changed": len(changed),
            "errors": len(errors),
            "results": results,
        }


async def build_morning_digests() -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{API_BASE_URL}/v1/internal/build-digests",
            headers=worker_headers(),
        )
        response.raise_for_status()
        return response.json()


async def requalify_verified_changes() -> dict:
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{API_BASE_URL}/v1/internal/requalify-verified-changes",
            headers=worker_headers(),
        )
        response.raise_for_status()
        return response.json()


async def advance_funding_call_statuses() -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{API_BASE_URL}/v1/internal/funding-calls/advance-statuses",
            headers=worker_headers(),
        )
        response.raise_for_status()
        return response.json()
