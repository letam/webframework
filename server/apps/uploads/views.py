"""Views for presigned media upload URLs."""

import json
import re
from datetime import datetime

from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from apps.blogs.models import Post
from apps.ratelimit import rate_limit

from .s3 import ALLOWED_CONTENT_TYPE_RE, generate_presigned_put_url

User = get_user_model()

MAX_FILE_NAME_LENGTH = 100


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
    """Validate a client upload request and return a presigned PUT URL."""
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

    content_length = data.get('content_length')
    # Reject bool explicitly: `isinstance(True, int)` is True, and a boolean here
    # is a malformed request, not a 1-byte upload.
    if not isinstance(content_length, int) or isinstance(content_length, bool):
        return JsonResponse({'error': 'content_length must be an integer'}, status=400)
    if not 0 < content_length <= settings.MAX_MEDIA_UPLOAD_BYTES:
        return JsonResponse(
            {'error': f'content_length must be between 1 and {settings.MAX_MEDIA_UPLOAD_BYTES}'},
            status=400,
        )

    if request.user.is_authenticated:
        user_id = request.user.id
        actual_author = str(user_id)
    else:
        # Anonymous uploads are keyed under the dedicated 'anonymous' user
        # (created by migrations / init_users).
        user_id = User.objects.get(username='anonymous').id
        actual_author = 'anon'

    expected_author = data.get('expected_author')
    if expected_author not in (None, '') and str(expected_author) != actual_author:
        return JsonResponse(
            {'error': 'The active session no longer matches this queued post.'},
            status=403,
        )
    file_path = f'post/audio/{user_id}/{file_name}'

    # check if file path is already used in the database
    if Post.objects.filter(media__s3_file_key=file_path).exists():
        # add a timestamp to the file name, preserving the extension if there is one
        stem, dot, extension = file_name.rpartition('.')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        file_name = f'{stem}-{timestamp}.{extension}' if dot else f'{file_name}-{timestamp}'
        file_path = f'post/audio/{user_id}/{file_name}'

    presigned_url = generate_presigned_put_url(file_path, content_type, content_length)

    return JsonResponse({'url': presigned_url, 'file_path': file_path})
