// NOTE: typescript-eslint doesn't support the TypeScript 7 native compiler yet
// (peer `typescript >=4.8.4 <6.1.0`), so it can't load against TS 7 directly.
// We run the two side-by-side per the TS 7 release guidance
// (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/):
// package.json aliases `typescript` -> real TS 6.0.x (what typescript-eslint
// imports) and `@typescript/native` -> TS 7 (which owns the `tsc` binary, so
// `tsc --noEmit` still type-checks on TS 7). Collapse this back to a single
// `typescript` once typescript-eslint supports TS 7.
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
