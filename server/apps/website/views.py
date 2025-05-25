from django.conf import settings
from django.shortcuts import render


def index(request):
    if settings.DEBUG:
        if response := local_dev_response_from_file_in_app_public_dir(request):
            return response

    template = 'website/index.html' if settings.DEBUG else 'website/dist/index.html'
    return render(request, template)


def local_dev_response_from_file_in_app_public_dir(request):
    path_includes_file_ext = request.path.count('.') > 0
    if not path_includes_file_ext:
        return
    import os
    import os.path

    from django.http import HttpResponse, HttpResponseNotFound

    public_dir = 'app/public'
    file_path = public_dir + request.path

    def get_content_response_type_for_file(filename: str) -> str | None:
        if filename.endswith('.woff2'):
            return 'font/woff2'
        if filename.endswith('.svg'):
            return 'image/svg+xml'
        if filename.rsplit('.', 1)[1] in ['jpg', 'jpeg']:
            return 'image/jpeg'
        if filename.endswith('.png'):
            return 'image/png'
        if filename.endswith('.json'):
            return 'application/json'
        if filename.endswith('.txt'):
            return 'text/plain'

    if os.path.isfile(file_path):
        with open(file_path, 'rb') as f:
            return HttpResponse(
                f.read(), content_type=get_content_response_type_for_file(request.path)
            )
    else:
        return HttpResponseNotFound('Requested resource not found in app/public/.')
