import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import { configDefaults } from 'vitest/config'

const NODE_ENV = process.env.NODE_ENV ?? ''

// https://vite.dev/config/
export default defineConfig(() => ({
	server: {
		host: '::',
		// port: 8080,
	},
	plugins: [tailwindcss(), react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},

	...(NODE_ENV === 'development' ? {} : {
		// Reference: https://vite.dev/config/shared-options.html#base ; https://vite.dev/guide/build.html#public-base-path
		base: '/static/app/',
	}),

	build: {
		rolldownOptions: {
			output: {
				// Pull React out of the app entry: it is eagerly loaded either way, so this
				// costs nothing on first paint but keeps ~74 kB gzip cached across deploys
				// that only touch our source. Deliberately React-only -- a broad
				// `{ test: /node_modules/ }` group hoists route-lazy deps into the eager
				// bundle, costing ~32 kB gzip on first load.
				// Reference: https://rolldown.rs/in-depth/manual-code-splitting
				codeSplitting: {
					groups: [
						{
							name: 'react-vendor',
							test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
						},
					],
				},
			},
		},
	},

	test: {
		environment: 'jsdom',
		// Pin the env the app reads, so a developer's own app/.env can't change what
		// the suite asserts. `VITE_SERVER_HOST=//localhost:8000` (the documented local
		// setting) otherwise prefixes every API URL and fails the posts API tests,
		// which pass in CI only because CI has no app/.env. Tests that care about a
		// value stub it per-test with `vi.stubEnv`.
		env: {
			VITE_SERVER_HOST: '',
			VITE_UPLOAD_FILES_TO_S3: 'false',
		},
		setupFiles: ['./vitest.setup.ts'],
		globals: true,
		exclude: [...configDefaults.exclude, 'e2e/**'],
	},
}))
