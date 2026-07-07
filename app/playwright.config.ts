import { defineConfig, devices } from '@playwright/test'

const e2ePort = process.env.CI ? 5173 : 5174

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: {
		baseURL: `http://localhost:${e2ePort}`,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], channel: 'chromium' },
		},
	],
	webServer: {
		command: `bun dev --host 127.0.0.1 --port ${e2ePort} --strictPort`,
		url: `http://localhost:${e2ePort}`,
		reuseExistingServer: false,
		timeout: 120000,
	},
})
