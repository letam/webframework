# Web Framework 2025
Boring web framework to get stuff done. A framework on top of frameworks.

Includes some functionality for a basic public micro-blogging app.

## Tech Stack
- [Python programming language](https://www.python.org/)
- [Django web framework](https://www.djangoproject.com/)
- [React UI library](https://react.dev/)
- [Vite web dev frontend build tool](https://vite.dev/)

### Package Managers
- [Bun](https://bun.sh)
- [uv](https://docs.astral.sh/uv/)

## Setup for Local Development

### Quick Setup (Recommended--or follow [Manual Setup](#manual-setup)):

1. Download and unzip project from [https://github.com/letam/web-framework-2025/archive/refs/heads/main.zip](https://github.com/letam/web-framework-2025/archive/refs/heads/main.zip) (or clone this repo)

2. Open terminal and change present directory to be the project directory

3. Run the setup script:
	```
	./scripts/setup.sh
	```

4. Start the development servers:
	- In one terminal:
		```
		uv run python server/manage.py runserver_plus
		```
	- In another terminal:
		```
		cd app ; bun dev
		```

The web app during development is served via http://localhost:8000

### Manual Setup
(If you don't want to run the quick setup script)

#### Download project
1. Download and unzip project from [https://github.com/letam/web-framework-2025/archive/refs/heads/main.zip](https://github.com/letam/web-framework-2025/archive/refs/heads/main.zip) (or clone this repo)
2. Open terminal and change present directory to be the project directory

#### Backend server
1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/)
2. Install Python dependencies:
		```
		uv sync
		```
3. Apply database migrations:
		```
		uv run python server/manage.py migrate
		```
4. Start the backend server:
		```
		uv run python server/manage.py runserver_plus
		```

#### Frontend server
1. In another terminal, change into the frontend app directory:
		```
		cd app
		```
2. Install [Bun](https://bun.sh)
3. Install npm packages:
		```
		bun i
		```
4. Create the `.env` file:
		```
		cp .env.development.local.sample .env
		```
5. Start the frontend dev server:
		```
		bun dev
		```

#### Misc setup stuff

- If you're on macOS and you didn't follow the quick setup, then ensure that you have installed [gsed](https://www.gnu.org/software/sed/), which can be done via `brew install gsed` or `scripts/setup/setup-mac.sh`. We use `gsed` in scripts to manage configuration-deployment of project.

## Setup for Production

1. Follow above steps to install Python and project dependencies for both backend and frontend servers

2. Build app for production
	```
	./scripts/build-prod.sh
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
