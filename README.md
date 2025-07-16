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

   **Option A: Using tmux session (Recommended)**

	```
	./scripts/start-dev-session.sh
	```
	This creates 2 tmux windows:

	- **Window 1 "servers"**: Backend server (left) and Frontend server (right)
	- **Window 2 "cli"**: CLI at project root (left) and CLI in app directory (right)

   **Option B: Manual terminal setup**

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

#### Install package managers and tools
1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) (for Python package/project management)
2. Install [Bun](https://bun.sh) (for JavaScript package/project management)
3. Install [tmux](https://github.com/tmux/tmux) (for development session management):
   - macOS: `brew install tmux`
   - Ubuntu/Debian: `sudo apt-get install tmux`

#### Download project
1. Download and unzip project from [https://github.com/letam/web-framework-2025/archive/refs/heads/main.zip](https://github.com/letam/web-framework-2025/archive/refs/heads/main.zip) (or clone this repo)
2. Open terminal and change present directory to be the project directory

#### Backend server
1. Install Python dependencies:
		```
		uv sync
		```
2. Apply database migrations:
		```
		uv run python server/manage.py migrate
		```
3. Start the backend server:
		```
		uv run python server/manage.py runserver_plus
		```

#### Frontend server
1. In another terminal, change into the frontend app directory:
		```
		cd app
		```
2. Install npm packages:
		```
		bun i
		```
3. Create the `.env` file:
		```
		cp .env.development.local.sample .env
		```
4. Start the frontend dev server:
		```
		bun dev
		```

#### Misc setup stuff

- If you're on macOS and you didn't follow the quick setup, then ensure that [gsed](https://www.gnu.org/software/sed/) is installed, which can be done via `brew install gsed` or `scripts/setup/setup-mac.sh`. We use `gsed` in scripts to manage configuration-deployment of project.

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
