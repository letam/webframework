from django.conf import settings
from django.db import models
import os.path
import os

import logging

from .utils import convert_to_mp3

# Configure logging
logger = logging.getLogger('server.apps.blogs')


def media_file_path(instance, filename):
    return f'post/{instance.id}/media/{filename}'

MEDIA_TYPE_CHOICES = [
    ('audio', 'Audio'),
    ('video', 'Video'),
]

class Post(models.Model):
    created = models.DateTimeField(auto_now_add=True)
    modified = models.DateTimeField(auto_now=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    head = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)
    media_type = models.CharField(max_length=255, blank=True, choices=MEDIA_TYPE_CHOICES)
    media = models.FileField(upload_to=media_file_path, blank=True)
    media_mp3 = models.FileField(upload_to=media_file_path, blank=True)
    media_s3_file_key = models.CharField(max_length=255, blank=True)
    parent = models.ForeignKey('Post', on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ['-created']

    def __str__(self):
        return self.head

    def save(self, *args, **kwargs):
        if self.id is None:
            media = self.media
            self.media = None
            super().save(*args, **kwargs)
            self.media = media
            if 'force_insert' in kwargs:
                kwargs.pop('force_insert')

        super().save(*args, **kwargs)

    def convert_media_to_mp3(self):
        """
        Convert the media file to MP3 format.
        """
        if not self.media.path.endswith('.mp3'):
            # Convert the media file to MP3 format
            convert_to_mp3(self.media.path)

            # get new media file name, using os.path.splitext
            new_media_file_name = os.path.splitext(self.media.name)[0] + '.mp3'

            # save the new mp3 file to the media_mp3 field
            self.media_mp3 = new_media_file_name
            self.save()

            # TODO: Fix to delete old media file from file system after update
            # # remove the old media file from file system
            # os.remove(old_media_file.path)

            # TODO: Run cleanup script to delete old media files from file system every hour
