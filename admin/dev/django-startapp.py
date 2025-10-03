#!/usr/bin/env python3

# Create Django app and configure onto Django project


from subprocess import run
from fileinput import FileInput


def runs(cmd: str):
    run(cmd, shell=True)


def execfile(filepath: str):
    exec(open(filepath).read())


# from pathlib import Path
# bin = Path('venv/bin')
# def create_django_app(name: str):
#     runs(f'{bin}/django-admin startapp {name}')
def create_django_app(name: str):
    runs(f'django-admin startapp {name}')


def add_django_app_to_project(name: str):
    create_django_app(app_name)
    with FileInput(f'{app_name}/apps.py', inplace=True) as file:
        for line in file:
            if 'name = ' in line:
                print(line.replace(app_name, f'apps.{app_name}'), end='')
            else:
                print(line, end='')
    runs(f'mv {app_name} server/apps')


if __name__ == '__main__':
    import os, sys

    # Add to venv/bin to PATH to run venv commands
    venv_bin_dir = os.getcwd() + '/venv/bin'
    os.environ['PATH'] = venv_bin_dir + os.pathsep + os.environ['PATH']

    if len(sys.argv) < 2:
        print('Required: app name')
        exit(1)

    app_name = sys.argv[1]
    add_django_app_to_project(app_name)
