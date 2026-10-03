import asyncio
import hashlib
import os
import re
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Header, HTTPException

from .renderers.dispatch import (
    UnsupportedOfficialFormFormat,
    render_official_document,
)
from .storage import get_bytes, put_bytes

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:4000")
WORKER_SECRET = os.getenv("INTERNAL_WORKER_SECRET", "")
POLL_SECONDS = float(os.getenv("DOCUMENT_WORKER_POLL_SECONDS", "5"))

_worker_task: asyncio.Task | None = None
_stop_event = asyncio.Event()


def worker_headers() -> dict[str, str]:
    if not WORKER_SECRET:
        raise RuntimeError("INTERNAL_WORKER_SECRET is required")
    return {"x-worker-secret": WORKER_SECRET}


def verify_worker_secret(received: str | None) -> None:
    if not WORKER_SECRET or received != WORKER_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def safe_output_name(original_name: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-zÀ-ž._() -]+", "_", original_name).strip()
    if "." not in cleaned:
        return f"{cleaned or 'formularz'}-wypelniony"

    stem, extension = cleaned.rsplit(".", 1)
    return f"{stem}-wypelniony.{extension}"


async def report_result(
    client: httpx.AsyncClient,
    job_id: str,
    payload: dict,
) -> None:
    response = await client.post(
        f"{API_BASE_URL}/v1/internal/document-jobs/{job_id}/result",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json=payload,
    )
    response.raise_for_status()


async def process_job(client: httpx.AsyncClient, job_id: str) -> dict:
    payload_response = await client.get(
        f"{API_BASE_URL}/v1/internal/document-jobs/{job_id}/payload",
        headers=worker_headers(),
    )
    payload_response.raise_for_status()
    payload = payload_response.json()

    source = payload["source"]
    source_bytes = get_bytes(source["storageKey"])
    actual_source_hash = hashlib.sha256(source_bytes).hexdigest()

    if actual_source_hash != source["sha256"]:
        raise RuntimeError(
            "SOURCE_HASH_MISMATCH: immutable official source differs from registry"
        )

    rendered, output_mime_type = render_official_document(
        source=source_bytes,
        original_name=source["originalName"],
        mime_type=source["mimeType"],
        mappings=payload["template"]["mappings"],
        values=payload["values"],
    )

    output_sha256 = hashlib.sha256(rendered).hexdigest()
    output_name = safe_output_name(source["originalName"])
    output_key = (
        f"cases/{payload['job']['caseId']}/rendered/"
        f"{job_id}/{output_sha256}/{output_name}"
    )

    put_bytes(
        output_key,
        rendered,
        output_mime_type,
    )

    await report_result(
        client,
        job_id,
        {
            "success": True,
            "outputStorageKey": output_key,
            "outputSha256": output_sha256,
            "outputMimeType": output_mime_type,
            "outputName": output_name,
        },
    )

    return {
        "jobId": job_id,
        "outputStorageKey": output_key,
        "outputSha256": output_sha256,
    }


async def claim_job(client: httpx.AsyncClient) -> str | None:
    response = await client.post(
        f"{API_BASE_URL}/v1/internal/document-jobs/claim",
        headers=worker_headers(),
    )
    response.raise_for_status()
    job = response.json().get("job")
    return job.get("id") if job else None


async def work_once() -> dict:
    async with httpx.AsyncClient(timeout=60.0) as client:
        job_id = await claim_job(client)
        if not job_id:
            return {"processed": False, "jobId": None}

        try:
            result = await process_job(client, job_id)
            return {"processed": True, "success": True, **result}
        except UnsupportedOfficialFormFormat as exc:
            await report_result(
                client,
                job_id,
                {
                    "success": False,
                    "errorCode": "UNSUPPORTED_OFFICIAL_FORM_FORMAT",
                    "errorMessage": str(exc),
                },
            )
            return {
                "processed": True,
                "success": False,
                "jobId": job_id,
                "errorCode": "UNSUPPORTED_OFFICIAL_FORM_FORMAT",
            }
        except Exception as exc:
            message = str(exc)
            error_code = (
                "SOURCE_HASH_MISMATCH"
                if message.startswith("SOURCE_HASH_MISMATCH")
                else "DOCUMENT_RENDER_FAILED"
            )
            try:
                await report_result(
                    client,
                    job_id,
                    {
                        "success": False,
                        "errorCode": error_code,
                        "errorMessage": message[:4000] or error_code,
                    },
                )
            except Exception:
                pass
            return {
                "processed": True,
                "success": False,
                "jobId": job_id,
                "errorCode": error_code,
                "error": message,
            }


async def worker_loop() -> None:
    while not _stop_event.is_set():
        try:
            result = await work_once()
            delay = 0.25 if result.get("processed") else POLL_SECONDS
        except Exception:
            delay = POLL_SECONDS

        try:
            await asyncio.wait_for(_stop_event.wait(), timeout=delay)
        except asyncio.TimeoutError:
            pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _worker_task
    _stop_event.clear()
    _worker_task = asyncio.create_task(worker_loop())
    yield
    _stop_event.set()
    if _worker_task:
        await _worker_task


app = FastAPI(
    title="DotacjaPRO Document Worker",
    lifespan=lifespan,
)


@app.get("/health")
def health():
    return {
        "service": "document-worker",
        "status": "ok",
        "official_form_only": True,
        "supported_formats": ["PDF", "DOCX", "XLSX"],
        "legacy_formats_blocked": ["DOC", "XLS"],
    }


@app.post("/work-once")
async def run_once(
    x_worker_secret: str | None = Header(default=None),
):
    verify_worker_secret(x_worker_secret)
    return await work_once()
