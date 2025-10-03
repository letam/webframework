import 'justfiles/django.just'


just-dump-all:
	for file in `ls justfiles`; do \
		echo $file; \
		just --dump -f justfiles/$file; \
	done
