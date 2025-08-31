#!/usr/bin/env python3
"""
Test script to verify EXIF orientation handling in image compression.
This script can be used to test if images are properly oriented after compression.
"""

import os
import sys
from pathlib import Path

# Add the server directory to the Python path
server_dir = Path(__file__).parent / 'server'
sys.path.insert(0, str(server_dir))

from apps.blogs.utils.image_processing import apply_exif_orientation, create_compressed_image
from PIL import Image


def test_exif_orientation():
    """Test EXIF orientation handling with a sample image."""

    # Create a test image with EXIF orientation data
    test_image_path = "/tmp/test_orientation.jpg"

    # Create a simple test image
    img = Image.new('RGB', (800, 600), color='red')

    # Add EXIF orientation data (rotate 90 degrees CW)
    try:
        from PIL import ExifTags

        # Get the EXIF orientation tag number
        orientation_tag = None
        for tag, name in ExifTags.TAGS.items():
            if name == 'Orientation':
                orientation_tag = tag
                break

        if orientation_tag:
            # Create EXIF data with orientation 6 (90 degrees CW)
            exif_dict = {orientation_tag: 6}
            exif_bytes = img.getexif()
            if exif_bytes is None:
                exif_bytes = {}
            exif_bytes.update(exif_dict)
            img.save(test_image_path, exif=exif_bytes)
        else:
            print("Could not find EXIF orientation tag")
            img.save(test_image_path)

    except ImportError:
        print("PIL ExifTags not available, saving without EXIF data")
        img.save(test_image_path)

    # Test our compression function
    compressed_path = create_compressed_image(test_image_path, "/tmp/test_compressed.jpg")

    if compressed_path:
        print("✅ Compressed image created successfully")

        # Check dimensions
        with Image.open(compressed_path) as comp_img:
            print(f"Original size: {img.size}")
            print(f"Compressed size: {comp_img.size}")

            # The compressed image should maintain the correct orientation
            # (original was 800x600 with EXIF orientation 6 = 90° CW rotation)
            # After rotation, dimensions become (600, 800)
            if comp_img.size == (600, 800):
                print("✅ EXIF orientation correctly applied - image rotated 90° CW")
                print("   Original: 800x600 → Rotated: 600x800 (dimensions swapped)")
            else:
                print("⚠️  EXIF orientation may not have been applied correctly")

        # Clean up
        os.remove(compressed_path)
    else:
        print("❌ Failed to create compressed image")

    # Clean up test image
    if os.path.exists(test_image_path):
        os.remove(test_image_path)


if __name__ == "__main__":
    print("Testing EXIF orientation handling...")
    test_exif_orientation()
    print("Test completed.")
