from django.conf import settings
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver

from .transcription import transcribe_audio


class Post(models.Model):

    created = models.DateTimeField(auto_now_add=True)
    modified = models.DateTimeField(auto_now=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    head = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)
    audio = models.FileField(upload_to='audio/', blank=True, null=True)
    audio_s3_file_key = models.CharField(max_length=255, blank=True, null=True)
    parent = models.ForeignKey('Post', on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ['-created']

    def __str__(self):
        return self.head


#  TODO: Instead of using post_save, transcribe the audio outside of main thread and update the post asynchronously
# @receiver(post_save, sender=Post)
def handle_audio_transcription(sender, instance, created, **kwargs):
    """
    Signal handler to transcribe audio when a post is saved with an audio file.
    Only transcribe if:
    1. The post has an audio file
    2. The post doesn't already have a body (to avoid overwriting existing content)
    3. The audio file is new or has changed
    """
    if instance.audio and not instance.body:
        try:
            transcript = transcribe_audio(instance.audio)
            # Update the body field with the transcript
            instance.body = transcript
            # Save without triggering the signal again
            update_kwargs = {
                'head': transcript,
                **({
                    'body': transcript,
                } if len(transcript) > 255 else {})
            }
            Post.objects.filter(id=instance.id).update(**update_kwargs)
        except Exception as e:

                Post.objects.filter(id=instance.id).update(body=transcript)
        except Exception as e:
            # Log the error but don't raise it to prevent saving from failing
            print(f"Error transcribing audio: {str(e)}")
