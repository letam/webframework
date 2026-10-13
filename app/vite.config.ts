import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import { configDefaults } from 'vitest/config'

const NODE_ENV = process.env.NODE_ENV ?? ''

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
	// Config runs before Vite injects mode files into import.meta.env. loadEnv also
	// preserves the priority of variables explicitly set by the invoking shell.
	const env = loadEnv(mode, process.cwd())
	const backendProxyTarget = env.VITE_WS_PROXY_TARGET || 'http://127.0.0.1:8000'
	return {
		server: {
			host: '::',
			// Socket handshakes retain the browser Origin; Django validates it.
			proxy: {
				'/auth/': { target: backendProxyTarget },
				'/api/': { target: backendProxyTarget },
				// Share pages and public avatars use Django-generated same-origin URLs.
				'/p/': { target: backendProxyTarget },
				'/media/': { target: backendProxyTarget },
				'/ws/': {
					target: backendProxyTarget,
					ws: true,
				},
			},
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
			// the suite asserts. A developer's old cross-origin `VITE_SERVER_HOST`
			// otherwise prefixes API URLs and breaks the same-origin test expectations.
			// Tests that care about a value stub it per-test with `vi.stubEnv`.
			env: {
				VITE_SERVER_HOST: '',
				VITE_UPLOAD_FILES_TO_S3: 'false',
				// Date formatting and week bucketing run in local time, so the date tests
				// assert different calendar days east of UTC+12. Pin the zone like the env.
				TZ: 'UTC',
			},
			setupFiles: ['./vitest.setup.ts'],
			globals: true,
			exclude: [...configDefaults.exclude, 'e2e/**'],
			coverage: {
				// Without `include`, coverage only counts files some test imports, so a module
				// nothing tests is missing from the denominator instead of showing as 0%.
				include: ['src/**/*.{ts,tsx}'],
				exclude: ['src/__tests__/**', 'src/**/*.d.ts'],
			},
		},
	}
})
