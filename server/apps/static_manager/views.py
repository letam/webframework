"""
Static files management views for easy file hosting and serving.
"""

import json
import mimetypes
import os
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.http import HttpResponse, HttpResponseNotFound, JsonResponse
from django.shortcuts import render
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods


class StaticFileView(View):
    """View for serving static files with proper MIME types and caching headers."""

    def get(self, request, file_path):
        """Serve a static file with proper headers."""
        # Security: prevent directory traversal
        if '..' in file_path or file_path.startswith('/'):
            return HttpResponseNotFound('File not found')

        # Try to find the file in static directories
        static_file_path = self._find_static_file(file_path)

        if not static_file_path or not static_file_path.exists():
            return HttpResponseNotFound('File not found')

        # Get MIME type
        mime_type, _ = mimetypes.guess_type(str(static_file_path))
        if not mime_type:
            mime_type = 'application/octet-stream'

        # Read file content
        try:
            with open(static_file_path, 'rb') as f:
                content = f.read()
        except (IOError, OSError):
            return HttpResponseNotFound('File not found')

        # Create response with proper headers
        response = HttpResponse(content, content_type=mime_type)

        # Set caching headers for static files
        response['Cache-Control'] = 'public, max-age=31536000'  # 1 year
        response['ETag'] = f'"{static_file_path.stat().st_mtime}"'

        return response

    def _find_static_file(self, file_path):
        """Find a static file in the configured static directories."""
        # Check STATIC_ROOT first
        static_root = Path(settings.STATIC_ROOT)
        full_path = static_root / file_path
        if full_path.exists():
            return full_path

        # Check STATICFILES_DIRS if in DEBUG mode
        if settings.DEBUG and hasattr(settings, 'STATICFILES_DIRS'):
            for static_dir in settings.STATICFILES_DIRS:
                full_path = Path(static_dir) / file_path
                if full_path.exists():
                    return full_path

        return None


@method_decorator(csrf_exempt, name='dispatch')
class StaticFileUploadView(View):
    """View for uploading static files via API."""

    def post(self, request):
        """Upload a static file."""
        if not request.FILES:
            return JsonResponse({'error': 'No file provided'}, status=400)

        file = request.FILES['file']
        file_path = request.POST.get('path', file.name)

        # Security: prevent directory traversal
        if '..' in file_path or file_path.startswith('/'):
            return JsonResponse({'error': 'Invalid file path'}, status=400)

        # Ensure the file path is within static directory
        static_root = Path(settings.STATIC_ROOT)
        full_path = static_root / file_path

        # Create directory if it doesn't exist
        full_path.parent.mkdir(parents=True, exist_ok=True)

        # Save the file
        try:
            with open(full_path, 'wb') as f:
                for chunk in file.chunks():
                    f.write(chunk)

            # Return file info
            file_url = f"{settings.STATIC_URL}{file_path}"
            return JsonResponse(
                {
                    'success': True,
                    'file_path': file_path,
                    'file_url': file_url,
                    'size': full_path.stat().st_size,
                }
            )

        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)

    def delete(self, request):
        """Delete a static file."""
        data = json.loads(request.body)
        file_path = data.get('path')

        if not file_path:
            return JsonResponse({'error': 'No file path provided'}, status=400)

        # Security: prevent directory traversal
        if '..' in file_path or file_path.startswith('/'):
            return JsonResponse({'error': 'Invalid file path'}, status=400)

        static_root = Path(settings.STATIC_ROOT)
        full_path = static_root / file_path

        if not full_path.exists():
            return JsonResponse({'error': 'File not found'}, status=404)

        try:
            full_path.unlink()
            return JsonResponse({'success': True})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)


@require_http_methods(["GET"])
def list_static_files(request):
    """List all static files in the static directory."""
    static_root = Path(settings.STATIC_ROOT)

    if not static_root.exists():
        return JsonResponse({'files': []})

    files = []
    for file_path in static_root.rglob('*'):
        if file_path.is_file():
            relative_path = file_path.relative_to(static_root)
            file_url = f"{settings.STATIC_URL}{relative_path}"
            files.append(
                {
                    'path': str(relative_path),
                    'url': file_url,
                    'size': file_path.stat().st_size,
                    'modified': file_path.stat().st_mtime,
                }
            )

    return JsonResponse({'files': files})


@require_http_methods(["GET"])
def static_file_info(request, file_path):
    """Get information about a specific static file."""
    # Security: prevent directory traversal
    if '..' in file_path or file_path.startswith('/'):
        return HttpResponseNotFound('File not found')

    static_root = Path(settings.STATIC_ROOT)
    full_path = static_root / file_path

    if not full_path.exists():
        return HttpResponseNotFound('File not found')

    mime_type, _ = mimetypes.guess_type(str(full_path))
    file_url = f"{settings.STATIC_URL}{file_path}"

    return JsonResponse(
        {
            'path': file_path,
            'url': file_url,
            'size': full_path.stat().st_size,
            'modified': full_path.stat().st_mtime,
            'mime_type': mime_type or 'application/octet-stream',
        }
    )


def static_files_manager(request):
    """Serve the static files manager interface."""
    return render(request, 'static_manager/manager.html')
