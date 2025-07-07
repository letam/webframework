"""server URL Configuration.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from apps.auth import views as auth_views
from apps.blogs.views import PostViewSet, get_post_media_mime_type, stream_post_media
from apps.uploads.views import get_presigned_url, get_presigned_url_for_post
from apps.website.views import index
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path
from rest_framework import routers

router = routers.DefaultRouter()
router.register(r'posts', PostViewSet)


# Order matters! More specific patterns should come before catch-all patterns
urlpatterns = [
    path('admin/', admin.site.urls),
    #
    path('auth/csrf/', auth_views.csrf),
    path('auth/login/', auth_views.login),
    path('auth/signup/', auth_views.signup),
    path('auth/logout/', auth_views.logout),
    path('auth/status/', auth_views.status),
    #
    path('api-auth/', include('rest_framework.urls')),
    #
    path('api/uploads/presign/', get_presigned_url, name='get_presigned_url'),
    path(
        'api/uploads/presign/<int:post_id>/',
        get_presigned_url_for_post,
        name='get_presigned_url_for_post',
    ),
    #
    path(
        'api/posts/<int:post_id>/media/mime-type/',
        get_post_media_mime_type,
        name='get_post_media_mime_type',
    ),
    path('api/posts/<int:post_id>/media/', stream_post_media, name='stream_post_media'),
    #
    path('api/', include(router.urls)),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Catch-all pattern for the frontend should be last
urlpatterns += [
    # https://docs.djangoproject.com/en/5.1/topics/http/urls/#using-regular-expressions
    re_path('', index),
]
