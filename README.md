# Web Framework 2025
Boring web framework to get stuff done. A framework on top of frameworks.

Includes some functionality for a basic public micro-blogging app.

## Tech Stack
- [Python programming language](https://www.python.org/)
- [Django web framework](https://www.djangoproject.com/)
- [React UI library](https://react.dev/)
- [Vite web dev frontend build tool](https://vite.dev/)
- [Bun](https://bun.sh)

## Setup for Local Development

### Quick Setup
1. Download and unzip project from [https://github.com/letam/web-framework-2025/archive/refs/heads/main.zip](https://github.com/letam/web-framework-2025/archive/refs/heads/main.zip)

2. Open terminal and change present directory to be the project directory

3. Run the setup script:
	```
	./scripts/setup.sh
	```

4. Start the development servers:
	- In one terminal:
		```
		python server/manage.py runserver_plus
		```
	- In another terminal:
		```
		cd app && bun dev
		```

The web app during development is served via http://localhost:8000

## Setup for Production

1. Follow above steps to install Python and project dependencies for both backend and frontend servers

2. Build app for production
	```
	./build-prod
	```

## Deploying to fly.io

### Config Type 1: Deploy on simple single webserver with SQLite database:

1. Set app name in project (Replace *your_app_name* with an actual app name):
```
sed -i.bak 's/FLY_APP_NAME/your_app_name/g' server/config/settings.py && find scripts/ -type f -name "deploy_*" -exec sed -i.bak 's/FLY_APP_NAME/your_app_name/g' {} +
```

2. Run app deployment script:
```
./scripts/deploy-fly.io-sqlite.sh <app_name>
```

### Config Type 2: Deploy using HA configuration with Postgres database:

1. Set app name in project (Replace *your_app_name* with an actual app name):
```
sed -i.bak 's/FLY_APP_NAME/your_app_name/g' server/config/settings.py && find scripts/ -type f -name "deploy_*" -exec sed -i.bak 's/FLY_APP_NAME/your_app_name/g' {} +
```

2. Run app deployment script:
```
./scripts/deploy-fly.io-postgres.sh <app_name>
```

### To use Cloudflare R2 object storage for user uploads (Required for Config Type 2):

TODO
