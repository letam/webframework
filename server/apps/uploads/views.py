from datetime import datetime

import boto3
from apps.blogs.models import Post
from botocore.config import Config
from django.conf import settings
from django.http import JsonResponse


def get_s3_client():
    return boto3.client(
        's3',
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        endpoint_url=settings.AWS_S3_ENDPOINT_URL,
        config=Config(signature_version='s3v4'),
    )


def get_presigned_url(request):
    if request.method == 'POST':
        import json

        data = json.loads(request.body)
        content_type = data['content_type']
        file_name = data['file_name']

        user_id = request.user.id if request.user.is_authenticated else 2
        file_path = f'post/audio/{user_id}/{file_name}'

        # check if file path is already used in the database
        if Post.objects.filter(media__s3_file_key=file_path).exists():
            # add a timestamp to the file_name while (attempting to) respecting the file extension
            file_name = (
                file_name.rsplit('.', 1)[0]
                + '-'
                + datetime.now().strftime('%Y%m%d_%H%M%S')
                + '.'
                + file_name.rsplit('.', 1)[1]
            )

        # idea: extract function to get presigned url as a portable function, to use it as a CLI command or django admin action.
        # Or! Is there a simpler way to make the request via CLI?
        s3 = get_s3_client()
        presigned_url = s3.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': settings.AWS_STORAGE_BUCKET_NAME,
                'Key': file_path,
                'ContentType': content_type,
            },
            ExpiresIn=300,  # URL valid for 5 minutes
        )

        return JsonResponse({'url': presigned_url, 'file_path': file_path})
    else:
        return JsonResponse({'error': 'Invalid request method'}, status=405)


def _get_presigned_url_for_file_path(file_path):
    s3 = get_s3_client()
    # TODO: Check if the signed url is already cached and is still valid for 5+ minutes, and use that cached value
    presigned_url = s3.generate_presigned_url(
        'get_object',
        Params={
            'Bucket': settings.AWS_STORAGE_BUCKET_NAME,
            'Key': file_path,
        },
        ExpiresIn=3600,  # URL valid for 1 hour
    )
    # TODO: Cache the signed url
    return presigned_url


def get_presigned_url_for_post(request, post_id):
    post = Post.objects.get(id=post_id)
    signed_url = _get_presigned_url_for_file_path(post.media.s3_file_key)
    return JsonResponse({'url': signed_url})
