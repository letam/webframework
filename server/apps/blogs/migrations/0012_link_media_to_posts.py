from django.db import migrations


def link_media_to_posts(apps, schema_editor):
    Post = apps.get_model('blogs', 'Post')
    Media = apps.get_model('blogs', 'Media')

    for post in Post.objects.all():
        if hasattr(post, 'tmp_media_id') and post.tmp_media_id:
            try:
                media = Media.objects.get(id=post.tmp_media_id)
                post.media = media
                post.save()
            except Media.DoesNotExist:
                # Skip if media record doesn't exist
                continue


def reverse_link_media_to_posts(apps, schema_editor):
    Post = apps.get_model('blogs', 'Post')

    for post in Post.objects.all():
        if post.media:
            post.tmp_media_id = post.media.id
            post.save()


class Migration(migrations.Migration):
    dependencies = [
        ('blogs', '0011_alter_post_media_field'),
    ]

    operations = [
        migrations.RunPython(
            link_media_to_posts,
            reverse_link_media_to_posts
        ),
        migrations.RemoveField(
            model_name='post',
            name='tmp_media_id',
        ),
    ]