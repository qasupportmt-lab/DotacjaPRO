import hashlib
import os
import re
from urllib.parse import unquote, urlparse

import boto3
import httpx
from botocore.exceptions import ClientError

_BUCKET_READY = False


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


def ensure_bucket():
    global _BUCKET_READY
    if _mode() != "s3" or _BUCKET_READY:
        return

    client = _client()
    bucket = _bucket()
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError:
        kwargs = {"Bucket": bucket}
        region = os.getenv("S3_REGION", "eu-central-1")
        endpoint = os.getenv("S3_ENDPOINT") or ""
        if not endpoint and region != "us-east-1":
            kwargs["CreateBucketConfiguration"] = {"LocationConstraint": region}
        client.create_bucket(**kwargs)

    _BUCKET_READY = True


def safe_filename(name: str, url: str) -> str:
    candidate = name.strip() if name else ""
    if not candidate:
        candidate = unquote(urlparse(url).path.rstrip("/").split("/")[-1])
    candidate = re.sub(r"[^0-9A-Za-zÀ-ž._() -]+", "_", candidate)
    return candidate[:180] or "document"


def _put_api(key: str, content: bytes, mime_type: str) -> None:
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


def put_official_document(
    source_id: str,
    sha256: str,
    original_name: str,
    source_url: str,
    content: bytes,
    mime_type: str,
) -> str:
    filename = safe_filename(original_name, source_url)
    key = f"official/{source_id}/{sha256}/{filename}"

    if _mode() == "api":
        _put_api(key, content, mime_type)
        return key

    ensure_bucket()
    _client().put_object(
        Bucket=_bucket(),
        Key=key,
        Body=content,
        ContentType=mime_type,
        Metadata={
            "sha256": sha256,
            "source-id": source_id,
        },
    )
    return key
