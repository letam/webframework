# Web Framework 2025
Boring web framework to get stuff done. A framework on top of frameworks.

Includes some functionality for a basic public micro-blogging app.

## Tech Stack
- [Python programming language](https://www.python.org/)
- [Django web framework](https://www.djangoproject.com/)
- [React UI library](https://react.dev/)
- [Vite web dev frontend build tool](https://vite.dev/)

## Setup for Local Development

### Backend server

1. Install latest Python binary

2. Download and unzip project from [https://github.com/letam/wut.sh/master.zip](https://github.com/letam/wut.sh/archive/refs/heads/main.zip)

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

7. Run other setup scripts
	```
	python server/manage.py init_users
	```

8. Run the development server
	```
	python server/manage.py runserver
	```

### Frontend server

1. In another terminal session, change into frontend app directory
	```
	cd app
	```

2. Install npm packages:
	```
	npm i
	```

3. Create `.env` file for frontend code
	```
	cp .env.development.local.sample .env
	```

4. Start frontend dev server
	```
	npm run dev
	```

## Setup for Production

1. Follow above steps to install Python and project dependencies for both backend and frontend servers

2. Build app for production
	```
	./build-prod
	```
