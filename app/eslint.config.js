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
			// This project does not use the React Compiler. eslint-plugin-react-hooks v7's
			// `recommended` preset bundles the compiler's Rules-of-React static analysis
			// (set-state-in-effect, refs, immutability, purity, preserve-manual-memoization,
			// set-state-in-render, static-components, …) as errors. In this codebase those
			// only flag intentional patterns (the latest-ref pattern in useFeedKeyboard,
			// media-state resets on URL change), vendored shadcn/ui internals, and
			// compiler-only concerns — none are runtime bugs here. Enable just the two
			// classic Hooks rules. If we adopt the React Compiler later, switch back to
			// `...reactHooks.configs.recommended.rules` and address the findings then.
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'warn',
			'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
			// `let` is legitimate when a variable is read (in a closure) before its single
			// assignment — e.g. Post.tsx's poll-interval id, whose stop/poll closures form a
			// definition cycle with the interval itself. Don't demand `const` in that case.
			'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
		},
	}
)
