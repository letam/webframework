from django.conf import settings
from django.db import models
import os.path
import os

import logging

from .utils import convert_to_mp3

# Configure logging
logger = logging.getLogger('server.apps.blogs')


def audio_file_path(instance, filename):
    return f'post/{instance.id}/audio/{filename}'


class Post(models.Model):
    created = models.DateTimeField(auto_now_add=True)
    modified = models.DateTimeField(auto_now=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    head = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)
    audio = models.FileField(upload_to=audio_file_path, blank=True, null=True)
    audio_s3_file_key = models.CharField(max_length=255, blank=True, null=True)
    parent = models.ForeignKey('Post', on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ['-created']

    def __str__(self):
        return self.head

    def save(self, *args, **kwargs):
        if self.id is None:
            audio = self.audio
            self.audio = None
            super().save(*args, **kwargs)
            self.audio = audio
            if 'force_insert' in kwargs:
                kwargs.pop('force_insert')

        super().save(*args, **kwargs)

    def convert_audio_to_mp3(self):
        """
        Convert the audio file to MP3 format.
        """
        if not self.audio.path.endswith('.mp3'):
            # Convert the audio file to MP3 format
            convert_to_mp3(self.audio.path)

            # get new audio file name, using os.path.splitext
            new_audio_file_name = os.path.splitext(self.audio.name)[0] + '.mp3'

            # save reference to old audio file
            old_audio_file = self.audio

            # update the audio field with the new mp3 file
            self.audio.name = new_audio_file_name

            self.save()

            # TODO: Fix to delete old audio file from file system after update
            # # remove the old audio file from file system
            # os.remove(old_audio_file.path)

            # TODO: Run cleanup script to delete old audio files from file system every hour
