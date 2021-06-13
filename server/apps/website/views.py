from django.shortcuts import render

def index(request):
    template = 'website/index.html'
    return render(request, template)
