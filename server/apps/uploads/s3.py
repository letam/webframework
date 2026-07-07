"""S3-compatible object storage helpers for upload and media flows."""

import logging
import re
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from django.conf import settings

logger = logging.getLogger(__name__)

# Only media uploads are expected; this rejects types like text/html that
# could be used to serve malicious content from the bucket. The optional
# codecs parameter is what browsers report for recorded media, e.g.
# 'audio/webm;codecs=opus'.
ALLOWED_CONTENT_TYPE_RE = re.compile(r'^(audio|video|image)/[\w.+-]+(;\s*codecs=[\w.,+" -]+)?$')


@lru_cache(maxsize=1)
def get_s3_client():
    """Return a cached S3-compatible boto3 client."""
    return boto3.client(
        's3',
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        endpoint_url=settings.AWS_S3_ENDPOINT_URL,
        config=Config(signature_version='s3v4'),
    )


def generate_presigned_put_url(key: str, content_type: str, expires_in: int = 300) -> str:
    """Generate a presigned PUT URL for uploading one object."""
    s3 = get_s3_client()
    return s3.generate_presigned_url(
        'put_object',
        Params={
            'Bucket': settings.AWS_STORAGE_BUCKET_NAME,
            'Key': key,
            'ContentType': content_type,
        },
        ExpiresIn=expires_in,
    )


def generate_presigned_get_url(key: str, expires_in: int = 3600) -> str:
    """Generate a presigned GET URL for downloading one object."""
    s3 = get_s3_client()
    return s3.generate_presigned_url(
        'get_object',
        Params={
            'Bucket': settings.AWS_STORAGE_BUCKET_NAME,
            'Key': key,
        },
        ExpiresIn=expires_in,
    )


def head_object(key: str) -> dict | None:
    """Return object metadata, or None when the key does not exist."""
    s3 = get_s3_client()
    try:
        return s3.head_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=key)
    except ClientError as error:
        code = error.response.get('Error', {}).get('Code')
        status_code = error.response.get('ResponseMetadata', {}).get('HTTPStatusCode')
        if code in {'404', 'NoSuchKey', 'NotFound'} or status_code == 404:
            return None
        raise


def delete_object(key: str) -> None:
    """Best-effort deletion for an object key."""
    try:
        s3 = get_s3_client()
        s3.delete_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=key)
    except Exception:
        logger.exception("Error deleting object %s", key)


def download_to_file(key: str, fileobj) -> None:
    """Download an object key into an open file object."""
    s3 = get_s3_client()
    s3.download_fileobj(settings.AWS_STORAGE_BUCKET_NAME, key, fileobj)
