from django.conf import settings
from django.shortcuts import render

def index(request):
    if settings.DEBUG:
        if request.path == '/fruits.json':
            from django.http import JsonResponse
            import json
            with open('app/public/fruits.json') as f:
                return JsonResponse(json.load(f), safe=False)

    template = 'website/index.html'
    return render(request, template)
