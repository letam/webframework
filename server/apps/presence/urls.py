"""HTTP routes included under /presence/."""

from django.urls import path

from .views import stats

app_name = 'presence'

urlpatterns = [path('stats/', stats, name='stats')]
