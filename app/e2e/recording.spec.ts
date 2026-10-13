import { test, expect } from '@playwright/test'

const GROUND_RULES = ['no-hate', 'be-respectful', 'safe-environment', 'be-awesome']

// launchOptions force a new worker, so Playwright only accepts them at the top level of
// a file — the denied-permission case lives in recording-denied.spec.ts for that reason.
test.use({
	permissions: ['microphone'],
	launchOptions: {
		args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
	},
})

test.describe('Recording from the composer', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript((rules) => {
			localStorage.setItem('ground-rules-accepted', JSON.stringify(rules))
		}, GROUND_RULES)
	})
	test('stops and posts from the dialog', async ({ page }) => {
		await page.goto('/')
		await page.getByRole('button', { name: 'Record Audio' }).click()
		const dialog = page.getByRole('dialog', { name: 'Record Audio' })
		await expect(dialog.getByText('Recording...')).toBeVisible()
		await expect(dialog.getByText('00:01')).toBeVisible({ timeout: 5000 })
		await dialog.getByRole('button', { name: 'Post', exact: true }).click()
		await expect(dialog).toBeHidden()
		await expect(page.getByText('Post created successfully!')).toBeVisible({ timeout: 15_000 })
		await expect(page.locator('[data-composer-input]')).toHaveValue('')
	})
})
