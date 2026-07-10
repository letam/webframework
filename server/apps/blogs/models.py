"""Data models for blog posts, media, views, likes, and comments."""

import contextlib
import logging
import os
import secrets
import tempfile

from django.conf import settings
from django.db import models
from django.utils.crypto import constant_time_compare

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

TRANSCRIPT_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('done', 'Done'),
    ('error', 'Error'),
]

VISIBILITY_PUBLIC = 'public'
VISIBILITY_UNLISTED = 'unlisted'
VISIBILITY_PRIVATE = 'private'
VISIBILITY_CHOICES = [
    (VISIBILITY_PUBLIC, 'Public'),
    (VISIBILITY_UNLISTED, 'Unlisted'),
    (VISIBILITY_PRIVATE, 'Private'),
]


def generate_share_token():
    """Generate a non-lookup post share token."""
    return secrets.token_urlsafe(16)


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
    waveform = models.JSONField(null=True, blank=True)
    transcript = models.TextField(blank=True)
    transcript_status = models.CharField(
        max_length=16, blank=True, default='', choices=TRANSCRIPT_STATUS_CHOICES
    )
    alt_text = models.TextField(blank=True)

    class Meta:
        """Model options for media."""

        constraints = [
            # Two rows sharing a key would delete each other's R2 object;
            # the create-time exists() check alone is race-prone.
            models.UniqueConstraint(
                fields=['s3_file_key'],
                condition=~models.Q(s3_file_key=''),
                name='unique_nonempty_s3_file_key',
            ),
        ]

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


class PostQuerySet(models.QuerySet):
    """Query helpers for post visibility."""

    def visible_to(self, user):
        """Return published posts visible in feeds for the given user."""
        queryset = self.filter(is_draft=False)
        if user is not None and user.is_authenticated:
            return queryset.filter(models.Q(visibility=VISIBILITY_PUBLIC) | models.Q(author=user))
        return queryset.filter(visibility=VISIBILITY_PUBLIC)


class Post(models.Model):
    """A micro-blog post."""

    created = models.DateTimeField(auto_now_add=True)
    modified = models.DateTimeField(auto_now=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    head = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)
    media = models.OneToOneField(Media, on_delete=models.SET_NULL, null=True, blank=True)
    parent = models.ForeignKey('Post', on_delete=models.SET_NULL, null=True, blank=True)
    visibility = models.CharField(
        max_length=16, choices=VISIBILITY_CHOICES, default=VISIBILITY_PUBLIC, db_index=True
    )
    is_draft = models.BooleanField(default=False, db_index=True)
    link_previews_enabled = models.BooleanField(default=True)
    pinned_at = models.DateTimeField(null=True, blank=True)
    share_token = models.CharField(max_length=32, default=generate_share_token)

    objects = PostQuerySet.as_manager()

    class Meta:
        """Model options for posts."""

        ordering = ['-created']

    def __str__(self):
        """Return the post headline."""
        return self.head

    def is_visible_to(self, user, token=None):
        """Return whether this post can be viewed by the given user and share token."""
        if user is not None and user.is_authenticated:
            if self.author_id == user.id or user.is_superuser:
                return True

        if self.is_draft:
            return False

        if self.visibility == VISIBILITY_PUBLIC:
            return True

        if self.visibility == VISIBILITY_UNLISTED and token:
            return constant_time_compare(str(token), self.share_token)

        return False

    def delete(self, *args, **kwargs):
        """Delete the post and its associated media row."""
        for preview in self.link_previews.all():
            try:
                preview.delete()
            except Exception as e:
                logger.error(f"Error deleting link preview {preview.id}: {str(e)}")

        # Delete the media record
        if self.media:
            try:
                self.media.delete()
            except Exception as e:
                logger.error(f"Error deleting media record {self.media.id}: {str(e)}")

        # Delete the record
        return super().delete(*args, **kwargs)


class LinkPreview(models.Model):
    """Fetched rich-card metadata for a URL mentioned in a post."""

    KIND_CHOICES = [('youtube', 'YouTube'), ('twitter', 'Twitter/X'), ('generic', 'Generic')]
    STATUS_CHOICES = [('pending', 'Pending'), ('ok', 'OK'), ('failed', 'Failed')]

    created = models.DateTimeField(auto_now_add=True)
    modified = models.DateTimeField(auto_now=True)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='link_previews')
    url = models.URLField(max_length=2000)
    position = models.PositiveSmallIntegerField(default=0)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default='generic')
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default='pending', db_index=True
    )
    fetch_attempts = models.PositiveSmallIntegerField(default=0)
    title = models.CharField(max_length=500, blank=True)
    description = models.TextField(blank=True)
    site_name = models.CharField(max_length=200, blank=True)
    author_name = models.CharField(max_length=200, blank=True)
    author_handle = models.CharField(max_length=100, blank=True)
    embed_id = models.CharField(max_length=100, blank=True)
    published_at = models.DateField(null=True, blank=True)
    image = models.ImageField(upload_to='link_previews/%Y/%m/', blank=True)
    fetched_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        """Model options for link previews."""

        ordering = ['position', 'id']
        constraints = [
            models.UniqueConstraint(fields=['post', 'url'], name='unique_post_link_url'),
        ]

    def __str__(self):
        """Return a readable preview label."""
        return f'{self.kind} preview for post {self.post_id}'

    def delete(self, *args, **kwargs):
        """Delete the stored preview image and the database row."""
        if self.image:
            try:
                self.image.storage.delete(self.image.name)
            except Exception as e:
                logger.error(f"Error deleting link preview image {self.image.name}: {str(e)}")

        return super().delete(*args, **kwargs)


class PostView(models.Model):
    """A unique viewer's counted view for a post."""

    created = models.DateTimeField(auto_now_add=True)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='views')
    viewer_key = models.CharField(max_length=64)

    class Meta:
        """Model options for post views."""

        constraints = [
            models.UniqueConstraint(fields=['post', 'viewer_key'], name='unique_post_viewer'),
        ]

    def __str__(self):
        """Return a readable post view label."""
        return f'{self.viewer_key} viewed post {self.post_id}'


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
