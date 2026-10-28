import { test, expect } from '@playwright/test'

const GROUND_RULES = ['no-hate', 'be-respectful', 'safe-environment', 'be-awesome']

// Top-level for the same reason as recording.spec.ts: launchOptions force a new worker.
test.use({
	permissions: [],
	launchOptions: { args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] },
})

test.describe('Recording without microphone permission', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript((rules) => {
			localStorage.setItem('ground-rules-accepted', JSON.stringify(rules))
		}, GROUND_RULES)
	})
	test('explains the denial inline and offers upload', async ({ page }) => {
		await page.goto('/')
		await page.getByRole('button', { name: 'Record Audio' }).click()
		const dialog = page.getByRole('dialog', { name: 'Record Audio' })
		await expect(dialog.getByText('Microphone access is blocked', { exact: false })).toBeVisible()
		await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible()
		await expect(dialog.getByRole('button', { name: 'Upload a file instead' })).toBeVisible()
		await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
	})
})
