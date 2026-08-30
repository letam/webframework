"""Session authentication views (login, signup, logout, CSRF, status).

This package is intentionally NOT listed in ``INSTALLED_APPS``: it has no models,
migrations, templates, or management commands, and its views are wired directly
in ``config/urls.py``. Registering it would also be an error — an ``AppConfig``
here derives the app label ``auth``, which collides with ``django.contrib.auth``.
Keep it a plain views module.
"""
