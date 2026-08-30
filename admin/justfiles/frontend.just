# justfile for frontend (app/) commands (using bun)
#
# Each recipe line runs in its own shell, so the `cd app` is chained with `&&`
# onto the command rather than standing on its own line.

# Install frontend dependencies
app-install:
    cd app && bun install

# Start the Vite dev server
app-dev:
    cd app && bun dev

# Type-check the frontend (TS 7 via the pinned native binary)
typecheck:
    cd app && bun run typecheck

# Lint the frontend (ESLint, warning ceiling pinned)
lint:
    cd app && bun run lint

# Biome check the frontend (lint + format, from the root biome.json)
check:
    cd app && bun run check

# Run frontend unit tests once (not watch mode)
test-app:
    cd app && bun run test

# Build the production SPA bundle
app-build:
    cd app && bun run build
