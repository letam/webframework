"""Data models for blog posts, media, likes, and comments."""

import contextlib
import logging
import os
import tempfile

from django.conf import settings
from django.db import models

from apps.uploads.s3 import delete_object, download_to_file

from .utils import get_field_file_duration

# Configure logging
logger = logging.getLogger('server.apps.blogs')


def media_file_path(instance, filename):
    """Build the upload path for a media-related file."""
    return f'post/{instance.id}/media/{filename}'


MEDIA_TYPE_CHOICES = [
    ('audio', 'Audio'),
    ('video', 'Video'),
    ('image', 'Image'),
]


class Media(models.Model):
    """A media asset attached to a post."""

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

    def __str__(self):
        """Return a readable media label."""
        return self.file.name or self.s3_file_key or f'Media {self.id}'

    def save(self, *args, **kwargs):
        """Save media and populate duration when it can be probed."""
        # If this is a new record with file and we don't yet have id for media_file_path def
        if self.id is None and self.file:  # pyright: ignore [reportAttributeAccessIssue]
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
                logger.info(f"Attempting to extract duration for {self.file.name}")
                duration = get_field_file_duration(self.file)
                if duration:
                    logger.info(f"Extracted duration: {duration} for {self.file.name}")
                    self.duration = duration
                    # Save again with duration
                    super().save(update_fields=['duration'])
                else:
                    logger.warning(f"Could not extract duration for {self.file.name}")
            except Exception as e:
                logger.error(f"Error extracting duration for {self.file.name}: {str(e)}")

    def delete(self, *args, **kwargs):
        """Delete stored media files, object-storage keys, and the database row."""
        media_dir = None
        if settings.USE_LOCAL_FILE_STORAGE and self.file:
            try:
                media_dir = os.path.dirname(self.file.path)
            except Exception as e:
                logger.error(f"Error getting media directory for {self.file.name}: {str(e)}")

        for field_name in ('file', 'mp3_file', 'thumbnail'):
            field = getattr(self, field_name)
            if not field:
                continue
            try:
                field.storage.delete(field.name)
            except Exception as e:
                logger.error(f"Error deleting {field_name} {field.name}: {str(e)}")

        if self.s3_file_key:
            delete_object(self.s3_file_key)

        # Delete the media directory if it exists
        if media_dir and os.path.exists(media_dir):
            try:
                os.rmdir(media_dir)
            except Exception as e:
                logger.error(f"Error deleting media directory {media_dir}: {str(e)}")

        # Delete the record
        return super().delete(*args, **kwargs)

    @contextlib.contextmanager
    def local_copy(self):
        """Yield a local filesystem path for this media's bytes."""
        for field_file in (self.mp3_file, self.file):
            if not field_file:
                continue

            try:
                path = field_file.path
            except (NotImplementedError, ValueError):
                temp_path = None
                suffix = os.path.splitext(field_file.name)[1]
                try:
                    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                        temp_path = temp_file.name
                        field_file.open('rb')
                        try:
                            while chunk := field_file.read(64 * 1024):
                                temp_file.write(chunk)
                        finally:
                            field_file.close()

                    yield temp_path
                    return
                finally:
                    if temp_path:
                        try:
                            os.unlink(temp_path)
                        except FileNotFoundError:
                            pass
            else:
                yield path
                return

        if self.s3_file_key:
            temp_path = None
            suffix = os.path.splitext(self.s3_file_key)[1]
            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                    temp_path = temp_file.name
                    download_to_file(self.s3_file_key, temp_file)

                yield temp_path
                return
            finally:
                if temp_path:
                    try:
                        os.unlink(temp_path)
                    except FileNotFoundError:
                        pass

        raise FileNotFoundError("No media file found")


class Post(models.Model):
    """A micro-blog post."""

    created = models.DateTimeField(auto_now_add=True)
    modified = models.DateTimeField(auto_now=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    head = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)
    media = models.OneToOneField(Media, on_delete=models.SET_NULL, null=True, blank=True)
    parent = models.ForeignKey('Post', on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        """Model options for posts."""

        ordering = ['-created']

    def __str__(self):
        """Return the post headline."""
        return self.head

    def delete(self, *args, **kwargs):
        """Delete the post and its associated media row."""
        # Delete the media record
        if self.media:
            try:
                self.media.delete()
            except Exception as e:
                logger.error(f"Error deleting media record {self.media.id}: {str(e)}")

        # Delete the record
        return super().delete(*args, **kwargs)


class Like(models.Model):
    """A user's like for a post."""

    created = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='likes'
    )
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='likes')

    class Meta:
        """Model options for likes."""

        constraints = [
            models.UniqueConstraint(fields=['user', 'post'], name='unique_user_post_like'),
        ]

    def __str__(self):
        """Return a readable like label."""
        return f'{self.user} likes post {self.post_id}'


class Comment(models.Model):
    """A comment on a post."""

    created = models.DateTimeField(auto_now_add=True)
    modified = models.DateTimeField(auto_now=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='comments')
    body = models.TextField()

    class Meta:
        """Model options for comments."""

        ordering = ['created']

    def __str__(self):
        """Return a readable comment label."""
        return f'Comment by {self.author} on post {self.post_id}'
