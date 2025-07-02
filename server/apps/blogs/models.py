import logging
import os
import os.path

from django.conf import settings
from django.db import models

from .utils import convert_to_mp3, get_media_duration

# Configure logging
logger = logging.getLogger('server.apps.blogs')


def media_file_path(instance, filename):
    return f'post/{instance.id}/media/{filename}'


MEDIA_TYPE_CHOICES = [
    ('audio', 'Audio'),
    ('video', 'Video'),
    ('image', 'Image'),
]


class Media(models.Model):
    created = models.DateTimeField(auto_now_add=True)
    modified = models.DateTimeField(auto_now=True)
    file = models.FileField(upload_to=media_file_path)
    mp3_file = models.FileField(upload_to=media_file_path, blank=True)
    s3_file_key = models.CharField(max_length=255, blank=True)
    media_type = models.CharField(max_length=255, choices=MEDIA_TYPE_CHOICES)
    duration = models.DurationField(null=True, blank=True)
    thumbnail = models.ImageField(upload_to=media_file_path, blank=True)
    transcript = models.TextField(blank=True)
    alt_text = models.TextField(blank=True)

    def save(self, *args, **kwargs):
        # If this is a new record with file and we don't yet have id for media_file_path def
        if self.id is None and self.file:
            # Store file temporarily outside of record
            file = self.file
            self.file = None

            # Save record without file, to first generate id for media_file_path
            super().save(*args, **kwargs)

            # Set file before re-saving
            self.file = file
            if 'force_insert' in kwargs:
                kwargs.pop('force_insert')

        # Save the record first to ensure file is on disk
        super().save(*args, **kwargs)

        # Set duration if file is present and duration is not set
        if self.file and not self.duration:
            try:
                logger.info(f"Attempting to extract duration for {self.file.path}")
                duration = get_media_duration(self.file.path)
                if duration:
                    logger.info(f"Extracted duration: {duration} for {self.file.path}")
                    self.duration = duration
                    # Save again with duration
                    super().save(update_fields=['duration'])
                else:
                    logger.warning(f"Could not extract duration for {self.file.path}")
            except Exception as e:
                logger.error(f"Error extracting duration for {self.file.path}: {str(e)}")

    def delete(self, *args, **kwargs):
        # Get the media directory path
        media_dir = os.path.dirname(self.file.path) if self.file else None

        # Delete the files from storage
        if self.file:
            try:
                if os.path.isfile(self.file.path):
                    os.remove(self.file.path)
            except Exception as e:
                logger.error(f"Error deleting file {self.file.path}: {str(e)}")

        if self.mp3_file:
            try:
                if os.path.isfile(self.mp3_file.path):
                    os.remove(self.mp3_file.path)
            except Exception as e:
                logger.error(f"Error deleting mp3 file {self.mp3_file.path}: {str(e)}")

        if self.thumbnail:
            try:
                if os.path.isfile(self.thumbnail.path):
                    os.remove(self.thumbnail.path)
            except Exception as e:
                logger.error(f"Error deleting thumbnail {self.thumbnail.path}: {str(e)}")

        # Delete the media directory if it exists
        if media_dir and os.path.exists(media_dir):
            try:
                os.rmdir(media_dir)
            except Exception as e:
                logger.error(f"Error deleting media directory {media_dir}: {str(e)}")

        # Delete the record
        super().delete(*args, **kwargs)

    def convert_to_mp3(self):
        """Convert the media file to MP3 format."""
        if not self.file.path.endswith('.mp3'):
            convert_to_mp3(self.file.path)
            new_media_file_name = os.path.splitext(self.file.name)[0] + '.mp3'
            self.mp3_file = new_media_file_name
            self.save()


class Post(models.Model):
    created = models.DateTimeField(auto_now_add=True)
    modified = models.DateTimeField(auto_now=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    head = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)
    media = models.OneToOneField(Media, on_delete=models.SET_NULL, null=True, blank=True)
    parent = models.ForeignKey('Post', on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ['-created']

    def __str__(self):
        return self.head

    def delete(self, *args, **kwargs):
        # Delete the media record
        if self.media:
            try:
                self.media.delete()
            except Exception as e:
                logger.error(f"Error deleting media record {self.media.id}: {str(e)}")

        # Delete the record
        super().delete(*args, **kwargs)
