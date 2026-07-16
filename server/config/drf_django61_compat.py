r"""Temporary compatibility bridge for Django 6.1 + DRF 3.17.1.

Django 6.1 removed the private ``cc_delim_re`` regex from ``django.utils.cache``.
DRF 3.17.1 still imports it (``rest_framework/views.py``) to split ``Vary``
headers; the import fails at module load, taking the whole URLconf down.

DRF has already fixed this on ``master`` (it now uses its own header-splitting
helper), but no release ships the fix yet. Until DRF cuts a Django-6.1-compatible
release, we restore the removed symbol with its historical definition
(``re.compile(r"\\s*,\\s*")``). Import this module before anything imports DRF —
settings.py does so at the top.

Remove this file once DRF releases Django 6.1 support and the pin is bumped.
"""

import re

from django.utils import cache as _django_cache

if not hasattr(_django_cache, "cc_delim_re"):
    # Historical definition from Django <= 6.0's django/utils/cache.py.
    _django_cache.cc_delim_re = re.compile(r"\s*,\s*")
