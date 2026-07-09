"""Background media processing helpers."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from array import array
from io import BytesIO

from django.core.files.base import ContentFile
from PIL import Image, ImageOps

VIDEO_THUMBNAIL_MAX_WIDTH = 1280
IMAGE_RENDITION_MAX_EDGE = 1600
POSTER_MAX_EDGE = 1280
IMAGE_SKIP_MAX_BYTES = 300 * 1024
WAVEFORM_BUCKETS = 120


def generate_video_poster(input_path: str) -> ContentFile | None:
    """Capture a JPEG poster frame from a video file."""
    with tempfile.TemporaryDirectory() as temp_dir:
        output_path = os.path.join(temp_dir, 'poster.jpg')
        for seek_time in ('0.5', '0'):
            _run_video_poster_ffmpeg(input_path, output_path, seek_time)
            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                with open(output_path, 'rb') as image_file:
                    return ContentFile(image_file.read())
        return None


def _run_video_poster_ffmpeg(input_path: str, output_path: str, seek_time: str) -> None:
    subprocess.run(
        [
            'ffmpeg',
            '-y',
            '-ss',
            seek_time,
            '-i',
            input_path,
            '-frames:v',
            '1',
            '-vf',
            "scale='min(1280,iw)':-2",
            '-q:v',
            '3',
            output_path,
        ],
        capture_output=True,
        check=False,
    )


def generate_audio_waveform(input_path: str) -> list[int] | None:
    """Decode audio and return normalized per-bucket peak amplitudes."""
    result = subprocess.run(
        ['ffmpeg', '-i', input_path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0 or not result.stdout:
        return None

    samples = array('h')
    samples.frombytes(result.stdout[: len(result.stdout) - (len(result.stdout) % 2)])
    if sys.byteorder != 'little':
        samples.byteswap()
    if not samples:
        return None

    bucket_count = min(WAVEFORM_BUCKETS, len(samples))
    peaks = []
    for index in range(bucket_count):
        start = index * len(samples) // bucket_count
        end = (index + 1) * len(samples) // bucket_count
        bucket = samples[start:end]
        peaks.append(max(abs(sample) for sample in bucket) if bucket else 0)

    loudest = max(peaks)
    if loudest <= 0:
        return None

    return [min(100, round((peak / loudest) * 100)) for peak in peaks]


def generate_image_rendition(input_path: str) -> ContentFile | None:
    """Return a compressed image rendition, or None when the original is small enough."""
    source_size = os.path.getsize(input_path)
    return generate_jpeg_rendition(
        input_path,
        max_edge=IMAGE_RENDITION_MAX_EDGE,
        skip_when_small=True,
        source_size=source_size,
    )


def generate_poster_rendition(source) -> ContentFile:
    """Return a compressed JPEG poster rendition from an uploaded image."""
    rendition = generate_jpeg_rendition(
        source,
        max_edge=POSTER_MAX_EDGE,
        skip_when_small=False,
        source_size=getattr(source, 'size', None),
    )
    if rendition is None:
        raise ValueError('poster rendition generation unexpectedly returned None')
    return rendition


def generate_jpeg_rendition(
    source,
    *,
    max_edge: int,
    skip_when_small: bool,
    source_size: int | None,
) -> ContentFile | None:
    """Normalize, resize, and encode an image source as a JPEG."""
    if hasattr(source, 'seek'):
        source.seek(0)

    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        if (
            skip_when_small
            and source_size is not None
            and max(image.size) <= max_edge
            and source_size <= IMAGE_SKIP_MAX_BYTES
        ):
            return None

        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        image = _flatten_to_rgb(image)

        buffer = BytesIO()
        image.save(buffer, format='JPEG', quality=80, optimize=True)

    if hasattr(source, 'seek'):
        source.seek(0)

    return ContentFile(buffer.getvalue())


def save_media_thumbnail(media, content: ContentFile, filename: str) -> None:
    """Save a thumbnail and remove the previous thumbnail object when replaced."""
    old_name = media.thumbnail.name if media.thumbnail else ''
    media.thumbnail.save(filename, content, save=False)
    media.save(update_fields=['thumbnail'])

    if old_name and old_name != media.thumbnail.name:
        media.thumbnail.storage.delete(old_name)


def _flatten_to_rgb(image: Image.Image) -> Image.Image:
    if image.mode in {'RGBA', 'LA'} or (
        image.mode == 'P' and image.info.get('transparency') is not None
    ):
        canvas = Image.new('RGB', image.size, 'white')
        alpha = image.convert('RGBA').getchannel('A')
        canvas.paste(image.convert('RGBA'), mask=alpha)
        return canvas

    if image.mode != 'RGB':
        return image.convert('RGB')

    return image
