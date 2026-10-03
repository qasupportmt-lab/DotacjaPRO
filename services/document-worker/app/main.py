import asyncio
import hashlib
import os
import re
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Header, HTTPException

from .analyzers.dispatch import analyze_official_document
from .renderers.dispatch import (
    UnsupportedOfficialFormFormat,
    render_official_document,
)
from .package_builder import build_package
from .package_mailer import send_package_email
from .storage import get_bytes, put_bytes, presigned_download_url

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




async def report_package_result(
    client: httpx.AsyncClient,
    job_id: str,
    payload: dict,
) -> None:
    response = await client.post(
        f"{API_BASE_URL}/v1/internal/package-jobs/{job_id}/result",
        headers={**worker_headers(), "Content-Type": "application/json"},
        json=payload,
    )
    response.raise_for_status()


async def claim_package_job(client: httpx.AsyncClient) -> str | None:
    response = await client.post(
        f"{API_BASE_URL}/v1/internal/package-jobs/claim",
        headers=worker_headers(),
    )
    response.raise_for_status()
    job = response.json().get("job")
    return job.get("id") if job else None


async def process_package_job(
    client: httpx.AsyncClient,
    job_id: str,
) -> dict:
    response = await client.get(
        f"{API_BASE_URL}/v1/internal/package-jobs/{job_id}/payload",
        headers=worker_headers(),
    )
    response.raise_for_status()
    payload = response.json()

    package_bytes, package_sha256, package_name = build_package(payload)
    storage_key = (
        f"cases/{payload['job']['caseId']}/packages/"
        f"{job_id}/{package_sha256}/{package_name}"
    )

    put_bytes(
        storage_key,
        package_bytes,
        "application/zip",
    )

    max_attachment = int(
        os.getenv("MAX_EMAIL_ATTACHMENT_BYTES", str(15 * 1024 * 1024))
    )
    link_expires = int(
        os.getenv("PACKAGE_LINK_EXPIRES_SECONDS", str(24 * 60 * 60))
    )

    attachment: bytes | None
    download_url: str | None

    if len(package_bytes) <= max_attachment:
        attachment = package_bytes
        download_url = None
    else:
        attachment = None
        download_url = presigned_download_url(
            storage_key,
            expires_seconds=link_expires,
        )

    send_package_email(
        recipient=payload["job"]["recipientEmail"],
        package_name=package_name,
        package_bytes=attachment,
        download_url=download_url,
        funding_call_title=payload["fundingCall"]["title"],
        institution_name=payload["fundingCall"]["institutionName"],
        message_id=job_id,
    )

    await report_package_result(
        client,
        job_id,
        {
            "success": True,
            "outputStorageKey": storage_key,
            "outputSha256": package_sha256,
            "outputName": package_name,
        },
    )

    return {
        "jobId": job_id,
        "outputStorageKey": storage_key,
        "outputSha256": package_sha256,
        "deliveryMode": "attachment" if attachment is not None else "signed_url",
    }


async def package_once() -> dict:
    async with httpx.AsyncClient(timeout=90.0) as client:
        job_id = await claim_package_job(client)
        if not job_id:
            return {"processed": False, "jobId": None}

        try:
            result = await process_package_job(client, job_id)
            return {"processed": True, "success": True, **result}
        except Exception as exc:
            message = str(exc)[:4000] or "PACKAGE_DELIVERY_FAILED"
            error_code = (
                "SMTP_NOT_CONFIGURED"
                if "SMTP_NOT_CONFIGURED" in message
                else "PACKAGE_DOCUMENT_HASH_MISMATCH"
                if "PACKAGE_DOCUMENT_HASH_MISMATCH" in message
                else "PACKAGE_DELIVERY_FAILED"
            )

            try:
                await report_package_result(
                    client,
                    job_id,
                    {
                        "success": False,
                        "errorCode": error_code,
                        "errorMessage": message,
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


async def claim_analysis(client: httpx.AsyncClient) -> str | None:
    response = await client.post(
        f"{API_BASE_URL}/v1/internal/templates/claim-analysis",
        headers=worker_headers(),
    )
    response.raise_for_status()
    template = response.json().get("template")
    return template.get("id") if template else None


async def analyze_once() -> dict:
    async with httpx.AsyncClient(timeout=60.0) as client:
        template_id = await claim_analysis(client)
        if not template_id:
            return {"processed": False, "templateId": None}

        try:
            response = await client.get(
                f"{API_BASE_URL}/v1/internal/templates/{template_id}/analysis-payload",
                headers=worker_headers(),
            )
            response.raise_for_status()
            payload = response.json()
            source = payload["source"]

            source_bytes = get_bytes(source["storageKey"])
            actual_hash = hashlib.sha256(source_bytes).hexdigest()
            if actual_hash != source["sha256"]:
                raise RuntimeError(
                    "SOURCE_HASH_MISMATCH: immutable official source differs from registry"
                )

            proposal = analyze_official_document(
                source=source_bytes,
                original_name=source["originalName"],
                mime_type=source["mimeType"],
            )

            save = await client.put(
                f"{API_BASE_URL}/v1/internal/templates/{template_id}/mappings",
                headers={**worker_headers(), "Content-Type": "application/json"},
                json={
                    "mappingStatus": "DRAFT",
                    "analysis": proposal["analysis"],
                    "mappings": proposal["mappings"],
                },
            )
            save.raise_for_status()

            return {
                "processed": True,
                "success": True,
                "templateId": template_id,
                "candidateFields": len(proposal["mappings"]),
            }
        except Exception as exc:
            message = str(exc)[:4000] or "FORM_ANALYSIS_FAILED"
            try:
                await client.post(
                    f"{API_BASE_URL}/v1/internal/templates/{template_id}/analysis-failed",
                    headers={**worker_headers(), "Content-Type": "application/json"},
                    json={"error": message},
                )
            except Exception:
                pass

            return {
                "processed": True,
                "success": False,
                "templateId": template_id,
                "error": message,
            }


async def worker_loop() -> None:
    while not _stop_event.is_set():
        try:
            package_result = await package_once()
            if package_result.get("processed"):
                delay = 0.25
            else:
                render_result = await work_once()
                if render_result.get("processed"):
                    delay = 0.25
                else:
                    analysis_result = await analyze_once()
                    delay = 0.25 if analysis_result.get("processed") else POLL_SECONDS
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
        "package_delivery": ["smtp_attachment", "signed_url_fallback"],
    }


@app.post("/work-once")
async def run_once(
    x_worker_secret: str | None = Header(default=None),
):
    verify_worker_secret(x_worker_secret)
    return await work_once()


@app.post("/analyze-once")
async def run_analysis_once(
    x_worker_secret: str | None = Header(default=None),
):
    verify_worker_secret(x_worker_secret)
    return await analyze_once()


@app.post("/package-once")
async def run_package_once(
    x_worker_secret: str | None = Header(default=None),
):
    verify_worker_secret(x_worker_secret)
    return await package_once()
