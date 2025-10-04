import 'admin/justfiles/django.just'


default:
    just --list

# Dump all just files in justfiles/ dir
just-dump-all:
	echo ; \
	for file in `ls admin/justfiles`; do \
		echo JUSTFILE: $file; \
		just --dump -f admin/justfiles/$file; \
		echo ; \
	done
