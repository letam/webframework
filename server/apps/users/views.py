"""Views for the users app."""

import logging
import uuid
from io import BytesIO

from django.core.files.base import ContentFile
from PIL import Image, ImageOps
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.blogs.utils import is_valid_image

from .utils import get_avatar_url

logger = logging.getLogger(__name__)

MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024
AVATAR_SIZE = 512


def _delete_stored_avatar(storage, name):
    """Delete an avatar object from storage, logging failures."""
    if not name:
        return

    try:
        storage.delete(name)
    except Exception:
        logger.exception('Failed to delete avatar file %s', name)


def _flatten_to_rgb(image):
    """Return an RGB image, flattening transparency onto white."""
    if image.mode == 'RGB':
        return image

    if image.mode in {'RGBA', 'LA'} or (image.mode == 'P' and 'transparency' in image.info):
        rgba = image.convert('RGBA')
        background = Image.new('RGB', rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel('A'))
        return background

    return image.convert('RGB')


def _process_avatar(uploaded_file):
    """Normalize an uploaded avatar image to a square 512px JPEG."""
    with Image.open(uploaded_file) as image:
        image = ImageOps.exif_transpose(image)
        width, height = image.size
        side = min(width, height)
        left = (width - side) // 2
        top = (height - side) // 2
        image = image.crop((left, top, left + side, top + side))
        image = image.resize((AVATAR_SIZE, AVATAR_SIZE), Image.Resampling.LANCZOS)
        image = _flatten_to_rgb(image)

        output = BytesIO()
        image.save(output, format='JPEG', quality=85)
        return output.getvalue()


@api_view(['POST', 'PUT', 'DELETE'])
@permission_classes([AllowAny])
def avatar(request):
    """Upload, replace, or remove the authenticated user's avatar."""
    if not request.user.is_authenticated:
        return Response(
            {'error': 'Authentication required'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user = request.user

    if request.method == 'DELETE':
        old_name = user.avatar.name if user.avatar else ''
        old_storage = user.avatar.storage if user.avatar else None
        user.avatar = ''
        user.save(update_fields=['avatar'])
        if old_storage:
            _delete_stored_avatar(old_storage, old_name)
        return Response({'avatar': None})

    avatar_file = request.FILES.get('avatar')
    if avatar_file is None:
        return Response({'error': 'avatar is required'}, status=status.HTTP_400_BAD_REQUEST)

    if avatar_file.size > MAX_AVATAR_UPLOAD_BYTES:
        return Response(
            {'error': 'Avatar must be 5 MB or smaller'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        if not is_valid_image(avatar_file):
            return Response(
                {'error': 'avatar must be a valid image'},
                status=status.HTTP_400_BAD_REQUEST,
            )
    finally:
        avatar_file.seek(0)

    image_bytes = _process_avatar(avatar_file)
    old_name = user.avatar.name if user.avatar else ''
    old_storage = user.avatar.storage if user.avatar else None

    filename = f'user_{user.pk}_{uuid.uuid4().hex}.jpg'
    user.avatar.save(filename, ContentFile(image_bytes), save=False)
    user.save(update_fields=['avatar'])

    if old_storage:
        _delete_stored_avatar(old_storage, old_name)

    return Response({'avatar': get_avatar_url(user)})
