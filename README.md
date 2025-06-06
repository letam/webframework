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

### Backend server

1. Install latest Python binary

2. Download and unzip project from [https://github.com/letam/web-framework-2025/archive/refs/heads/main.zip](https://github.com/letam/web-framework-2025/archive/refs/heads/main.zip)

3. Open terminal and change present directory to be the project directory

4. Create and activate python virtual environment for the project
	```
	python3 -m venv venv
	source venv/bin/activate
	```

5. Install project requirements
	```
	pip install -U pip
	pip install -r requirements.txt
	```

6. Run project migrations
	```
	python server/manage.py migrate
	```

7. Run the development server (using django-extensions and werkzeug)
	```
	python server/manage.py runserver_plus
	```

The web app during development is served via http://localhost:8000, but you may not see anything until after you set up and start the frontend server.

### Frontend server

1. In another terminal session, change into frontend app directory
	```
	cd app
	```

2. Install npm packages (via bun):
	```
	bun i
	```

3. Create `.env` file for frontend code
	```
	cp .env.development.local.sample .env
	```

4. Start frontend dev server
	```
	bun dev
	```

### Accessing development server

Remember to access the local web app via http://localhost:8000

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
