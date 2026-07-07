import json
import re
from datetime import datetime

import boto3
from apps.blogs.models import Post
from apps.ratelimit import rate_limit
from botocore.config import Config
from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_POST

User = get_user_model()

# Only media uploads are expected; this rejects types like text/html that
# could be used to serve malicious content from the bucket. The optional
# codecs parameter is what browsers report for recorded media, e.g.
# 'audio/webm;codecs=opus'.
ALLOWED_CONTENT_TYPE_RE = re.compile(r'^(audio|video|image)/[\w.+-]+(;\s*codecs=[\w.,+" -]+)?$')
MAX_FILE_NAME_LENGTH = 100


def get_s3_client():
    return boto3.client(
        's3',
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        endpoint_url=settings.AWS_S3_ENDPOINT_URL,
        config=Config(signature_version='s3v4'),
    )


def _clean_file_name(file_name):
    """Reduce a client-supplied file name to a safe S3 key segment, or None."""
    if not isinstance(file_name, str):
        return None
    # Drop any client-supplied directories; also guards against key smuggling
    # like '../../other-prefix/file'.
    file_name = file_name.replace('\\', '/').rsplit('/', 1)[-1]
    file_name = re.sub(r'[^\w.\- ]', '_', file_name).strip()
    if not file_name.strip('. ') or len(file_name) > MAX_FILE_NAME_LENGTH:
        return None
    return file_name


@require_POST
@rate_limit('presign-upload', limit=30, window_seconds=3600)
def get_presigned_url(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid JSON body'}, status=400)

    content_type = data.get('content_type')
    if not isinstance(content_type, str) or not ALLOWED_CONTENT_TYPE_RE.match(content_type):
        return JsonResponse(
            {'error': 'content_type must be an audio, video or image type'}, status=400
        )

    file_name = _clean_file_name(data.get('file_name'))
    if not file_name:
        return JsonResponse({'error': 'file_name is missing or invalid'}, status=400)

    if request.user.is_authenticated:
        user_id = request.user.id
    else:
        # Anonymous uploads are keyed under the dedicated 'anonymous' user
        # (created by migrations / init_users).
        user_id = User.objects.get(username='anonymous').id
    file_path = f'post/audio/{user_id}/{file_name}'

    # check if file path is already used in the database
    if Post.objects.filter(media__s3_file_key=file_path).exists():
        # add a timestamp to the file name, preserving the extension if there is one
        stem, dot, extension = file_name.rpartition('.')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        file_name = f'{stem}-{timestamp}.{extension}' if dot else f'{file_name}-{timestamp}'
        file_path = f'post/audio/{user_id}/{file_name}'

    # idea: extract function to get presigned url as a portable function, to use
    # it as a CLI command or django admin action.
    # Or! Is there a simpler way to make the request via CLI?
    s3 = get_s3_client()
    presigned_url = s3.generate_presigned_url(
        'put_object',
        Params={
            'Bucket': settings.AWS_STORAGE_BUCKET_NAME,
            'Key': file_path,
            'ContentType': content_type,
        },
        ExpiresIn=300,  # URL valid for 5 minutes
    )

    return JsonResponse({'url': presigned_url, 'file_path': file_path})


def _get_presigned_url_for_file_path(file_path):
    s3 = get_s3_client()
    # TODO: Check if the signed url is already cached and is still valid for
    # 5+ minutes, and use that cached value
    presigned_url = s3.generate_presigned_url(
        'get_object',
        Params={
            'Bucket': settings.AWS_STORAGE_BUCKET_NAME,
            'Key': file_path,
        },
        ExpiresIn=3600,  # URL valid for 1 hour
    )
    # TODO: Cache the signed url
    return presigned_url


def get_presigned_url_for_post(request, post_id):
    post = get_object_or_404(Post.objects.select_related('media'), id=post_id)
    if not post.media or not post.media.s3_file_key:
        return JsonResponse({'error': 'Post has no media in object storage'}, status=404)
    signed_url = _get_presigned_url_for_file_path(post.media.s3_file_key)
    return JsonResponse({'url': signed_url})
