import json

from django.contrib.auth import get_user_model
from django.contrib.auth import login as auth_login
from django.contrib.auth import logout as auth_logout
from django.contrib.auth.forms import AuthenticationForm
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_http_methods, require_POST

UserModel = get_user_model()


def csrf(request):
    return JsonResponse({'token': get_token(request)})


@require_POST
def login(request):
    """Reference: https://docs.djangoproject.com/en/5.1/topics/auth/default/#django.contrib.auth.login."""
    data = json.loads(request.body) if request.body else {}
    form = AuthenticationForm(request, data=data)

    if not form.is_valid():
        errors = form.errors.copy()
        if '__all__' in errors:
            errors['form'] = errors.pop('__all__')
        return JsonResponse(errors, status=400)

    auth_login(request, form.get_user())
    user_id = form.get_user().id  # type: ignore

    return JsonResponse(user_id, safe=False)


@require_http_methods(["GET", "POST", "DELETE"])
def logout(request):
    """Reference: https://docs.djangoproject.com/en/5.1/topics/auth/default/#django.contrib.auth.logout."""
    auth_logout(request)

    return JsonResponse({})


def status(request):
    return JsonResponse(
        {
            'is_authenticated': request.user.is_authenticated,
            'user_id': request.user.id,
            'username': request.user.username,
            'is_staff': request.user.is_staff,
            'is_superuser': request.user.is_superuser,
        }
    )
