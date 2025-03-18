from django.contrib import admin

from .models import Post


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):

    list_display = (
        'id',
        'author',
        'head',
        'audio',
        'created',
        'modified',
    )
    readonly_fields = (
        'created',
        'modified',
    )
