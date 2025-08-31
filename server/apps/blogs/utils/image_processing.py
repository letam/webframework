import logging
import os
from io import BytesIO
from typing import Optional

from django.core.files.base import ContentFile
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Compression settings
COMPRESSED_MAX_SIZE = (1200, 1200)  # Max width/height for compressed images
COMPRESSED_QUALITY = 80  # JPEG quality (0-100)
COMPRESSED_FORMAT = 'JPEG'


def create_compressed_image(
    original_image_path: str, output_path: Optional[str] = None
) -> Optional[str]:
    """
    Create a compressed version of an image.

    Args:
        original_image_path: Path to the original image file
        output_path: Optional output path for the compressed image

    Returns:
        Path to the compressed image file, or None if compression fails
    """
    try:
        # Open the original image
        with Image.open(original_image_path) as img:
            # Convert to RGB if necessary (for PNG with transparency, etc.)
            if img.mode in ('RGBA', 'LA', 'P'):
                # Create a white background
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            # Resize if larger than max dimensions
            if img.size[0] > COMPRESSED_MAX_SIZE[0] or img.size[1] > COMPRESSED_MAX_SIZE[1]:
                img.thumbnail(COMPRESSED_MAX_SIZE, Image.Resampling.LANCZOS)

            # Save to BytesIO buffer
            buffer = BytesIO()
            img.save(buffer, format=COMPRESSED_FORMAT, quality=COMPRESSED_QUALITY, optimize=True)
            buffer.seek(0)

            # Generate output path if not provided
            if output_path is None:
                base_path = os.path.splitext(original_image_path)[0]
                output_path = f"{base_path}_compressed.jpg"

            # Save the compressed image
            with open(output_path, 'wb') as f:
                f.write(buffer.getvalue())

            logger.info(f"Compressed image created: {output_path}")
            return output_path

    except Exception as e:
        logger.error(f"Error creating compressed image for {original_image_path}: {str(e)}")
        return None


def create_compressed_image_contentfile(original_image_path: str) -> Optional[ContentFile]:
    """
    Create a compressed version of an image as a Django ContentFile.

    Args:
        original_image_path: Path to the original image file

    Returns:
        ContentFile containing the compressed image, or None if compression fails
    """
    try:
        # Open the original image
        with Image.open(original_image_path) as img:
            # Convert to RGB if necessary
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            # Resize if larger than max dimensions
            if img.size[0] > COMPRESSED_MAX_SIZE[0] or img.size[1] > COMPRESSED_MAX_SIZE[1]:
                img.thumbnail(COMPRESSED_MAX_SIZE, Image.Resampling.LANCZOS)

            # Save to BytesIO buffer
            buffer = BytesIO()
            img.save(buffer, format=COMPRESSED_FORMAT, quality=COMPRESSED_QUALITY, optimize=True)
            buffer.seek(0)

            # Create filename
            original_filename = os.path.basename(original_image_path)
            base_name = os.path.splitext(original_filename)[0]
            compressed_filename = f"{base_name}_compressed.jpg"

            return ContentFile(buffer.getvalue(), name=compressed_filename)

    except Exception as e:
        logger.error(
            f"Error creating compressed image ContentFile for {original_image_path}: {str(e)}"
        )
        return None


def is_image_file(file_path: str) -> bool:
    """
    Check if a file is an image based on its extension.

    Args:
        file_path: Path to the file

    Returns:
        True if the file is an image, False otherwise
    """
    image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'}
    _, ext = os.path.splitext(file_path.lower())
    return ext in image_extensions


def get_image_dimensions(file_path: str) -> Optional[tuple[int, int]]:
    """
    Get the dimensions of an image file.

    Args:
        file_path: Path to the image file

    Returns:
        Tuple of (width, height) or None if unable to get dimensions
    """
    try:
        with Image.open(file_path) as img:
            return img.size
    except Exception as e:
        logger.error(f"Error getting image dimensions for {file_path}: {str(e)}")
        return None
