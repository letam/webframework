import json

from django.contrib.auth import get_user_model
from django.contrib.auth import login as auth_login
from django.contrib.auth import logout as auth_logout
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_http_methods, require_POST

UserModel = get_user_model()


class CustomUserCreationForm(UserCreationForm):
    """Custom user creation form that works with our custom User model."""

    class Meta(UserCreationForm.Meta):
        model = UserModel
        fields = ('username',)


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


@require_POST
def signup(request):
    """Handle user registration and auto-login."""
    data = json.loads(request.body) if request.body else {}
    form = CustomUserCreationForm(data=data)

    if not form.is_valid():
        errors = form.errors.copy()
        # Convert field errors to a more user-friendly format
        field_errors = {}
        for field, error_list in errors.items():
            if field == '__all__':
                field_errors['form'] = error_list
            else:
                field_errors[field] = error_list
        return JsonResponse(field_errors, status=400)

    # Create the user
    user = form.save()

    # Auto-login the user
    auth_login(request, user)

    return JsonResponse(
        {
            'user_id': user.id,
            'username': user.username,
            'message': 'Account created successfully!',
        }
    )


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
