from django.contrib import admin

from .models import Media, Post


@admin.register(Media)
class MediaAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'file',
        'media_type',
        'duration',
        'created',
        'modified',
    )
    readonly_fields = (
        'created',
        'modified',
    )


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'author',
        'head',
        'get_media_type',
        'get_media_duration',
        'created',
        'modified',
    )
    readonly_fields = (
        'created',
        'modified',
    )

    def get_media_type(self, obj):
        return obj.media.media_type if obj.media else '-'

    get_media_type.short_description = 'Media Type'

    def get_media_duration(self, obj):
        return obj.media.duration if obj.media else '-'

    get_media_duration.short_description = 'Media Duration'
