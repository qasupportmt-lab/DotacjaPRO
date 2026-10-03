import os
from io import BytesIO

import boto3


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
    response = _client().get_object(Bucket=_bucket(), Key=key)
    return response["Body"].read()


def put_bytes(key: str, content: bytes, mime_type: str) -> None:
    _client().put_object(
        Bucket=_bucket(),
        Key=key,
        Body=BytesIO(content),
        ContentType=mime_type,
    )
