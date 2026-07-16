// NOTE: `bun run lint` is temporarily non-functional under TypeScript 7.
// typescript-eslint (all channels) still declares `typescript` peer `<6.1.0`
// and @typescript-eslint/typescript-estree throws on load against the TS 7
// native compiler. ESLint is not a CI gate here — Biome (`bunx biome ci`) is
// the lint gate and `tsc --noEmit` is the type gate; both run in CI and pass.
// Re-enable this once typescript-eslint ships TypeScript 7 support.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{ ignores: ['dist'] },
	{
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
		},
		plugins: {
			'react-hooks': reactHooks,
			'react-refresh': reactRefresh,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
		},
	}
)
