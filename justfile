import 'admin/justfiles/dev.just'
import 'admin/justfiles/django.just'
import 'admin/justfiles/frontend.just'
import 'admin/justfiles/fly.io.just'


default:
    just --list

# Run the full local gate the way CI does: backend lint + tests, then every
# frontend check. Mirrors .github/workflows/ci.yml (minus the Playwright e2e
# job, which needs a browser install) so a green `just verify` predicts green
# CI. Pins ruff/biome to CI's versions so local and CI enforce the same tools.
verify:
    uvx ruff@0.15.20 check --no-fix server/
    uvx ruff@0.15.20 format --check server/
    uv run python server/manage.py test apps
    cd app && bun install --frozen-lockfile
    cd app && bunx @biomejs/biome@2.3.11 ci .
    cd app && bun run typecheck
    cd app && bun run lint
    cd app && bun run test
    cd app && bun run build

# Dump all just files in justfiles/ dir
just-dump-all:
	echo ; \
	for file in `ls admin/justfiles`; do \
		echo JUSTFILE: $file; \
		just --dump -f admin/justfiles/$file; \
		echo ; \
	done
