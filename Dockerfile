ARG PYTHON_VERSION=3.13
ARG PYTHON_IMAGE_VERSION=${PYTHON_VERSION}-slim
# Match CI, which builds the frontend with bun (oven-sh/setup-bun) against the
# committed bun.lock — the production image must do the same, not npm.
ARG BUN_VERSION=1

# Reference for Dockerizing Django app: https://www.docker.com/blog/how-to-dockerize-django-app/
# Reference for Dockerizing React app: https://www.docker.com/blog/how-to-dockerize-react-app/


# Build Stage: Backend
FROM python:${PYTHON_IMAGE_VERSION} AS build-backend

# Set environment variables
# Prevents Python from writing pyc files to disk
ENV PYTHONDONTWRITEBYTECODE=1
# Prevents Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1

# Update package lists
RUN apt-get update

# Install psycopg2 dependencies
RUN apt-get install -y libpq-dev gcc

# Install curl (and certificates) for uv installation
RUN apt-get install -y --no-install-recommends curl ca-certificates

# Clean up apt package lists
RUN rm -rf /var/lib/apt/lists/*

# Create the app directory
RUN mkdir -p /code

# Set the working directory inside the container
WORKDIR /code

# Install uv (https://docs.astral.sh/uv/guides/integration/docker/#installing-uv)
ADD https://astral.sh/uv/0.7.11/install.sh /uv-installer.sh
RUN sh /uv-installer.sh && rm /uv-installer.sh
ENV PATH="/root/.local/bin/:$PATH"

# Export the exact, hashed dependency set from the committed lockfile rather than
# re-resolving the floating ranges in pyproject.toml at build time. This installs
# what CI locked and tested; `--frozen` fails the build if uv.lock has drifted
# from pyproject.toml instead of silently picking newer versions.
COPY pyproject.toml uv.lock /code/
RUN uv export --frozen --no-dev --no-emit-project -o requirements.txt

# Install dependencies (pip enforces --require-hashes given the hashes uv emits).
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend files to the container
COPY server .

# Collect static files
# SECRET_KEY is only needed to import settings; scope it to this one command
# rather than the whole stage.
RUN SECRET_KEY="DUMMY_SECRET_KEY_FOR_BUILD_PROCESS" python manage.py collectstatic --noinput


# Build Stage: Frontend
FROM oven/bun:${BUN_VERSION} AS build-frontend

# Run the build as root so WORKDIR/COPY/install are not tripped up by the image's
# default user across bun tag variants.
USER root

# Set the working directory inside the container (created automatically)
WORKDIR /code

# Copy the manifest and the committed lockfile CI gates on
COPY app/package.json app/bun.lock ./

# Install from the frozen lockfile — the same resolution CI tested, not a fresh
# one. (npm --legacy-peer-deps also masked the deliberate TS6/TS7 peer split.)
RUN bun install --frozen-lockfile

# Copy the rest of your application files
COPY app .

# Build frontend files
RUN bun run build

# Add build timestamp to index-*.js
RUN echo "// Build time: $(date +'%Y-%m-%d %H:%M:%S %Z')" >> dist/assets/index-*.js


# Production Stage: Integrate and Serve
FROM python:${PYTHON_IMAGE_VERSION} AS production

# # Install utilities for investigation
# RUN apt-get update && apt-get install -y \
#     openssh-client \
#     iputils-ping \
#     inetutils-traceroute \
#     mtr-tiny \
#     netcat-openbsd \
#     postgresql-client \
#     iperf3 \
#     && rm -rf /var/lib/apt/lists/*

# Install utilities used in production
RUN apt-get update && apt-get install -y \
    ffmpeg \
    file \
    && rm -rf /var/lib/apt/lists/*

# Copy the Python dependencies from the builder stage
COPY --from=build-backend /usr/local/lib/python3.13/site-packages/ /usr/local/lib/python3.13/site-packages/
COPY --from=build-backend /usr/local/bin/ /usr/local/bin/

# Set the working directory
RUN mkdir -p /code
WORKDIR /code

# Copy the built backend files
COPY --from=build-backend /code .

# Defense in depth: never ship a baked-in .env. Real config comes from the
# environment (Fly secrets) at runtime, and settings.py deliberately does not
# fabricate a SECRET_KEY in a production layout — so a stray .env must not
# smuggle one into a registry-readable image layer.
RUN rm -f /code/.env

# Copy the compiled frontend files
COPY --from=build-frontend /code/dist /code/static/app

# Log launched timestamp in index-*.js
RUN echo "console.log('Launched at: $(date +'%Y-%m-%d %H:%M:%S %Z')');" >> /code/static/app/assets/index-*.js

# Setup to serve fully integrated index.html
ARG WEBSITE_TEMPLATE_DIST_DIR="apps/website/templates/website/dist"
RUN mkdir -p "$WEBSITE_TEMPLATE_DIST_DIR"
RUN cp static/app/index.html "$WEBSITE_TEMPLATE_DIST_DIR/index.html"

### Add timestamp (local timezone, with UTC offset) to index.html
RUN sed -i "s|<!-- TIMESTAMP -->|<!-- TIMESTAMP: $(date +'%Y-%m-%d %H:%M:%S %Z') -->|" "$WEBSITE_TEMPLATE_DIST_DIR/index.html"

# Set environment variables to optimize Python
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Serve the integrated app
EXPOSE 8000

CMD ["bash", "start-prod.sh"]
