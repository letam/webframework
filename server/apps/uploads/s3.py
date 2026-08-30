"""S3-compatible object storage helpers for upload and media flows."""

import logging
import re
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

logger = logging.getLogger(__name__)

# Settings that must all be present before an S3 call can mean anything. Checked
# together because a partial set is the dangerous case: boto3 reads a None
# endpoint_url as "use real AWS" and a None access key as "use the ambient
# credential chain", so a deployment missing only R2_ACCOUNT_ID would quietly
# sign URLs against https://<bucket>.s3.amazonaws.com instead of failing.
REQUIRED_S3_SETTINGS = (
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_ENDPOINT_URL',
    'AWS_STORAGE_BUCKET_NAME',
)

# Only media uploads are expected; this rejects types like text/html that
# could be used to serve malicious content from the bucket. The optional
# codecs parameter is what browsers report for recorded media, e.g.
# 'audio/webm;codecs=opus'.
ALLOWED_CONTENT_TYPE_RE = re.compile(r'^(audio|video|image)/[\w.+-]+(;\s*codecs=[\w.,+" -]+)?$')


def require_s3_settings() -> None:
    """Raise unless every setting an S3 call depends on is present.

    Called from both object storage entry points: the helpers below, and the
    Django storage backend in ``apps.uploads.storage`` — django-storages reads
    these settings itself and never passes through ``get_s3_client``.

    Raises:
        ImproperlyConfigured: If any R2 setting is missing, naming which.
    """
    missing = [name for name in REQUIRED_S3_SETTINGS if not getattr(settings, name, None)]
    if missing:
        raise ImproperlyConfigured(
            'Object storage is not configured: missing '
            f'{", ".join(missing)}. Set the R2_* environment variables, or set '
            'USE_LOCAL_FILE_STORAGE=True to keep media on the filesystem.'
        )


@lru_cache(maxsize=1)
def get_s3_client():
    """Return a cached S3-compatible boto3 client.

    Raises:
        ImproperlyConfigured: If any R2 setting is missing. lru_cache does not
            cache exceptions, so this re-raises per call rather than poisoning
            the client for the life of the process.
    """
    require_s3_settings()
    return boto3.client(
        's3',
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        endpoint_url=settings.AWS_S3_ENDPOINT_URL,
        config=Config(signature_version='s3v4'),
    )


def generate_presigned_put_url(
    key: str, content_type: str, content_length: int | None = None, expires_in: int = 300
) -> str:
    """Generate a presigned PUT URL for uploading one object.

    When ``content_length`` is given it is signed into the URL, which adds
    ``content-length`` to ``X-Amz-SignedHeaders``. R2/S3 then enforces the exact
    byte count at the edge: an upload whose ``Content-Length`` differs from the
    signed value is rejected before its body is stored, rather than being caught
    only afterwards by the post-create ``head_object`` size check.
    """
    params = {
        'Bucket': settings.AWS_STORAGE_BUCKET_NAME,
        'Key': key,
        'ContentType': content_type,
    }
    if content_length is not None:
        params['ContentLength'] = content_length
    s3 = get_s3_client()
    return s3.generate_presigned_url('put_object', Params=params, ExpiresIn=expires_in)


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
