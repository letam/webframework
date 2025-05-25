#!/usr/bin/env python3

import logging
import os
import shutil
import subprocess

logger = logging.getLogger('server.apps.blogs')


def get_output_filename(input_file: str) -> str:
    base, _ = os.path.splitext(input_file)
    return base + ".mp3"


def convert_to_mp3(input_file: str) -> str:
    """Converts a file to MP3 format using the local ffmpeg binary located in the project.

    Parameters:
        input_file (str): Path to the input media file.
    """
    # raise error if ffmpeg is not installed
    if not shutil.which("ffmpeg"):
        raise FileNotFoundError("ffmpeg is not installed")

    output_file = get_output_filename(input_file)

    # TODO: Handle case when file already exists

    # fmt: off
    command = [
        "ffmpeg",
        "-i", input_file,
        "-vn",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "96k",
        output_file
    ]
    # fmt: on

    try:
        subprocess.run(command, capture_output=True, check=True)
        logger.debug("Conversion successful! Output file: %s", output_file)
    except subprocess.CalledProcessError as error:
        logger.error("Error during conversion:")
        logger.error(error.stderr.decode())

    return output_file


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        filename = sys.argv[1]
    else:
        logger.error("No input file provided.")
        exit(1)

    convert_to_mp3(filename)
