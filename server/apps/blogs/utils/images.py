"""Image validation and normalization helpers."""

from PIL import Image


def is_valid_image(source) -> bool:
    """Return True when source (a path or file object) contains a decodable image."""
    try:
        with Image.open(source) as image:
            image.verify()
    except Exception:
        return False
    return True


def flatten_to_rgb(image: Image.Image) -> Image.Image:
    """Return an RGB copy of ``image``, compositing transparency onto white.

    Images with an alpha channel (RGBA/LA) or palette transparency are pasted
    onto a white background, so a saved JPEG (which has no alpha) shows white
    where the source was transparent rather than black. Other non-RGB modes are
    converted directly; an image already in RGB is returned unchanged.
    """
    if image.mode in {'RGBA', 'LA'} or (
        image.mode == 'P' and image.info.get('transparency') is not None
    ):
        rgba = image.convert('RGBA')
        canvas = Image.new('RGB', rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.getchannel('A'))
        return canvas

    if image.mode != 'RGB':
        return image.convert('RGB')

    return image
