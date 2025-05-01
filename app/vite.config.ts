import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import { componentTagger } from 'lovable-tagger'

const NODE_ENV = process.env.NODE_ENV ?? ''

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
	server: {
		host: '::',
		// port: 8080,
	},
	plugins: [
		tailwindcss(),
		react(),
		mode === 'development' &&
		componentTagger()
	].filter(Boolean),
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},

	...(NODE_ENV === 'development' ? {} : {
		// Reference: https://vite.dev/config/shared-options.html#base ; https://vite.dev/guide/build.html#public-base-path
		base: '/static/app/',
	}),

	test: {
		environment: 'jsdom',
		setupFiles: ['./vitest.setup.ts'],
		globals: true,
	},
}))
