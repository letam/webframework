"""Image validation helpers."""

from PIL import Image


def is_valid_image(source) -> bool:
    """Return True when source (a path or file object) contains a decodable image."""
    try:
        with Image.open(source) as image:
            image.verify()
    except Exception:
        return False
    return True
