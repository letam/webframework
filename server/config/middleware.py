"""Project-level middleware."""

from django.db import connection
from django.http import JsonResponse


class HealthCheckMiddleware:
    """Answer /healthz/ before host validation so platform checks always work.

    Fly's HTTP checks hit the machine directly with an unpredictable Host
    header; running before any get_host() caller keeps health checks exempt
    from ALLOWED_HOSTS without weakening it for real traffic.
    """

    def __init__(self, get_response):
        """Store the downstream response callable."""
        self.get_response = get_response

    def __call__(self, request):
        """Return health responses or pass through normal requests."""
        if request.path in ('/healthz', '/healthz/'):
            try:
                with connection.cursor() as cursor:
                    cursor.execute('SELECT 1')
            except Exception:
                return JsonResponse({'status': 'error'}, status=503)
            return JsonResponse({'status': 'ok'})
        return self.get_response(request)
