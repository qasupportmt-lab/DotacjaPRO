import hashlib
import os
from io import BytesIO
from urllib.parse import quote

import boto3
import httpx


def _mode() -> str:
    return os.getenv("OBJECT_STORAGE_MODE", "api").lower()


def _api_base_url() -> str:
    return os.getenv("API_BASE_URL", "http://localhost:4000").rstrip("/")


def _worker_secret() -> str:
    value = os.getenv("INTERNAL_WORKER_SECRET")
    if not value:
        raise RuntimeError("INTERNAL_WORKER_SECRET is required")
    return value


def _client():
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT") or None,
        region_name=os.getenv("S3_REGION", "eu-central-1"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY") or None,
        aws_secret_access_key=os.getenv("S3_SECRET_KEY") or None,
    )


def _bucket() -> str:
    value = os.getenv("S3_BUCKET")
    if not value:
        raise RuntimeError("S3_BUCKET is required")
    return value


def get_bytes(key: str) -> bytes:
    if _mode() == "api":
        response = httpx.get(
            f"{_api_base_url()}/v1/internal/storage/object?key={quote(key, safe='')}",
            headers={"x-worker-secret": _worker_secret()},
            timeout=90.0,
        )
        response.raise_for_status()
        content = response.content
        declared = response.headers.get("x-object-sha256")
        if declared:
            actual = hashlib.sha256(content).hexdigest()
            if declared != actual:
                raise RuntimeError("STORAGE_OBJECT_HASH_MISMATCH")
        return content

    response = _client().get_object(Bucket=_bucket(), Key=key)
    return response["Body"].read()


def put_bytes(key: str, content: bytes, mime_type: str) -> None:
    if _mode() == "api":
        digest = hashlib.sha256(content).hexdigest()
        response = httpx.put(
            f"{_api_base_url()}/v1/internal/storage/object",
            headers={
                "x-worker-secret": _worker_secret(),
                "x-storage-key": key,
                "x-object-content-type": mime_type,
                "x-object-sha256": digest,
                "content-type": "application/octet-stream",
            },
            content=content,
            timeout=90.0,
        )
        response.raise_for_status()
        return

    _client().put_object(
        Bucket=_bucket(),
        Key=key,
        Body=BytesIO(content),
        ContentType=mime_type,
    )


def presigned_download_url(
    key: str,
    expires_seconds: int = 24 * 60 * 60,
) -> str:
    if _mode() == "api":
        response = httpx.post(
            f"{_api_base_url()}/v1/internal/storage/download-link",
            headers={
                "x-worker-secret": _worker_secret(),
                "content-type": "application/json",
            },
            json={
                "storageKey": key,
                "expiresSeconds": expires_seconds,
            },
            timeout=30.0,
        )
        response.raise_for_status()
        return response.json()["url"]

    return _client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": _bucket(),
            "Key": key,
        },
        ExpiresIn=expires_seconds,
    )
