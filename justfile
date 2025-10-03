import 'justfiles/django.just'


default:
    just --list

# Dump all just files in justfiles/ dir
just-dump-all:
	for file in `ls justfiles`; do \
		echo $file; \
		just --dump -f justfiles/$file; \
	done
