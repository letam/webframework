ARG PYTHON_VERSION=3.13
ARG PYTHON_IMAGE_VERSION=${PYTHON_VERSION}-slim
ARG NODE_VERSION=22
ARG NODE_IMAGE_VERSION=${NODE_VERSION}-alpine

# Reference for Dockerizing Django app: https://www.docker.com/blog/how-to-dockerize-django-app/
# Reference for Dockerizing React app: https://www.docker.com/blog/how-to-dockerize-react-app/


# Build Stage: Backend
FROM python:${PYTHON_IMAGE_VERSION} as build-backend

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

# Compile requirements.txt dependencies from pyproject.toml
COPY pyproject.toml /code/
RUN uv pip compile pyproject.toml -o requirements.txt

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend files to the container
COPY server .

# Collect static files
ENV SECRET_KEY "DUMMY_SECRET_KEY_FOR_BUILD_PROCESS"
RUN python manage.py collectstatic --noinput


# Build Stage: Frontend
FROM node:${NODE_IMAGE_VERSION} AS build-frontend

# Create the app directory
RUN mkdir -p /code

# Set the working directory inside the container
WORKDIR /code

# Copy package.json and package-lock.json
COPY app/package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of your application files
COPY app .

# Build frontend files
RUN npm run build


# Production Stage: Integrate and Serve
FROM python:${PYTHON_IMAGE_VERSION} as production

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

# Copy the compiled frontend files
COPY --from=build-frontend /code/dist /code/static/app

# Setup to serve fully integrated index.html
ARG WEBSITE_TEMPLATE_DIST_DIR="apps/website/templates/website/dist"
RUN mkdir -p "$WEBSITE_TEMPLATE_DIST_DIR"
RUN cp static/app/index.html "$WEBSITE_TEMPLATE_DIST_DIR/index.html"

# Remove development-related code from index.html
RUN sed -i '\|content="https://lovable.dev|d' "$WEBSITE_TEMPLATE_DIST_DIR/index.html"
RUN sed -i '\|cdn.gpteng.co/gptengineer.js|d' "$WEBSITE_TEMPLATE_DIST_DIR/index.html"
RUN sed -i '/IMPORTANT: DO NOT REMOVE THIS SCRIPT TAG OR THIS VERY COMMENT!/d' "$WEBSITE_TEMPLATE_DIST_DIR/index.html"

# Set environment variables to optimize Python
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Serve the integrated app
EXPOSE 8000

CMD ["gunicorn","--bind",":8000","--workers","2","config.wsgi"]
