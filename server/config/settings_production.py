# NOTE: This file is not used. Leave it here for reference.
# We are using .env file for environment variable settings.

from .settings import *
from pathlib import Path


DEBUG = False


SECRET_KEY_FILE = "server/config/secret_key.txt"

def generate_server_secret_key():
    if not Path(SECRET_KEY_FILE).is_file():
        print("Generate secret key for production...")
        from django.core.management.utils import get_random_secret_key
        Path(SECRET_KEY_FILE).write_text(get_random_secret_key(), encoding="utf-8")
generate_server_secret_key()

with open(SECRET_KEY_FILE) as f:
    SECRET_KEY = f.read().strip()


ALLOWED_HOSTS = [
    "127.0.0.1",
    "localhost",
    "webframework.app",
    "dev.webframework.app",
]

CORS_ALLOWED_ORIGINS.extend(
    [
        "http://127.0.0.1:8000",
        "https://dev.webframework.app",
    ]
)


# We using SQLite, not PostgreSQL :-)


# import dj_database_url
# import urllib.parse
# import os
# import getpass

# with open(
#     f"/home/{os.environ.get('SUDO_USER') or getpass.getuser()}/.credentials/psql/webframework.app"
# ) as fd:
#     credentials = {
#         var: val.rstrip("\n")
#         for var, val in [line.split("=", 1) for line in fd if "=" in line]
#     }

# # Encode every special character in value, for use in URLs
# for k, v in credentials.items():
#     if k in ["db_password"]:
#         v = v.strip("'")
#     credentials[k] = urllib.parse.quote(v)

# db_user = credentials["db_user"]
# db_password = credentials["db_password"]
# db_host = credentials["db_host"]
# db_name = credentials["db_name"]

# if db_host == "localhost":
#     db_host = ""

# DATABASES["default"] = dj_database_url.parse(
#     f"postgres://{db_user}:{db_password}@{db_host}/{db_name}"
# )
