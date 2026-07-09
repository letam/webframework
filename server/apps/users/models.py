"""Custom user model definitions."""

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Project user model."""

    avatar = models.ImageField(upload_to='avatars/', blank=True)
