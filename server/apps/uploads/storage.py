"""Django storage backend for S3-compatible object storage (Cloudflare R2)."""

from apps.uploads.s3 import require_s3_settings
from storages.backends.s3boto3 import S3Boto3Storage


class GuardedS3Boto3Storage(S3Boto3Storage):
    """S3 storage that refuses to run against a half-configured deployment.

    django-storages reads ``AWS_S3_ENDPOINT_URL`` and the credentials straight
    from settings, so it never passes through ``apps.uploads.s3.get_s3_client``
    and the check there. Without this subclass a deployment missing only
    ``R2_ACCOUNT_ID`` hands boto3 ``endpoint_url=None`` on every save through
    Django's storage API — avatars, post media, link-preview images — which
    means real AWS via the ambient credential chain, while the presign helpers
    next door correctly refuse.

    The check hangs off ``_create_session`` because both ``connection`` and
    ``unsigned_connection`` build through it, so one hook covers every read,
    write, delete and signed URL that reaches the network. It has to be lazy:
    raising in ``__init__`` (or in settings) would break local dev and the CI
    test job, which legitimately run with no R2 configuration at all.
    """

    def _create_session(self):
        """Refuse to build a boto3 session against incomplete R2 settings."""
        require_s3_settings()
        return super()._create_session()
