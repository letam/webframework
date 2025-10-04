"""
URL patterns for static files management.
"""

from django.urls import path

from . import views

app_name = 'static_manager'

urlpatterns = [
    # Static files manager interface
    path('manager/', views.static_files_manager, name='manager'),
    # Serve static files
    path('files/<path:file_path>', views.StaticFileView.as_view(), name='serve_file'),
    # Upload static files
    path('upload/', views.StaticFileUploadView.as_view(), name='upload_file'),
    # List all static files
    path('list/', views.list_static_files, name='list_files'),
    # Get file info
    path('info/<path:file_path>', views.static_file_info, name='file_info'),
]
