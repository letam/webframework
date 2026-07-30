// NOTE: typescript-eslint doesn't support the TypeScript 7 native compiler yet
// (peer `typescript >=4.8.4 <6.1.0` — still true of 8.65.0, checked 2026-07-28), so
// it can't load against TS 7 directly. We run the two side-by-side per the TS 7
// release guidance (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/):
// package.json aliases `typescript` -> real TS 6.0.x, which THIS FILE is the only
// consumer of, and `@typescript/native` -> TS 7, which everything else type-checks
// against. Both ship a `tsc` binary, so bare `bunx tsc` picks a compiler by
// install-order luck; use `bun run typecheck`, which names the TS 7 binary by path.
// Collapse back to a single `typescript` once typescript-eslint supports TS 7.
// See CLAUDE.md, "Two TypeScript versions".
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// eslint-plugin-react-hooks v7's `recommended` preset bundles the React Compiler's
// Rules-of-React static analysis alongside the two classic Hooks rules. This project
// does not run the compiler, and in this codebase those rules only flag intentional
// patterns (the latest-ref pattern in useFeedKeyboard, media-state resets on URL
// change), vendored shadcn/ui internals, and compiler-only concerns — none are
// runtime bugs here.
//
// Turn them off by name rather than dropping the preset: spreading `recommended`
// keeps any *classic* rule a future release adds, and this deny-list makes the
// compiler-specific opt-out explicit. If we adopt the React Compiler, delete this
// list and address the findings.
const REACT_COMPILER_RULES = Object.fromEntries(
	[
		'config',
		'error-boundaries',
		'gating',
		'globals',
		'immutability',
		'incompatible-library',
		'preserve-manual-memoization',
		'purity',
		'refs',
		'set-state-in-effect',
		'set-state-in-render',
		'static-components',
		'unsupported-syntax',
		'use-memo',
	].map((rule) => [`react-hooks/${rule}`, 'off'])
)

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
			// See REACT_COMPILER_RULES above: the preset stays live, its compiler-only
			// rules are switched off by name.
			...reactHooks.configs.recommended.rules,
			...REACT_COMPILER_RULES,
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
