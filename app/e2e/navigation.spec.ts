import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
	test.beforeEach(async ({ page }) => {
		// Bypass the ground rules modal by setting localStorage
		await page.addInitScript(() => {
			localStorage.setItem(
				'ground-rules-accepted',
				JSON.stringify(['no-hate', 'be-respectful', 'safe-environment', 'be-awesome'])
			)
		})
	})

	test('should navigate between pages using navbar links', async ({ page }) => {
		await page.goto('/')

		// Navigate to settings
		await page.getByRole('link', { name: /settings/i }).click()
		await expect(page).toHaveURL('/settings')

		// Navigate back to home
		await page.getByRole('link', { name: /home/i }).click()
		await expect(page).toHaveURL('/')
	})

	test('should show 404 page for unknown routes', async ({ page }) => {
		await page.goto('/non-existent-page')

		// Check for the 404 heading specifically
		await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
	})

	test('should navigate home when clicking the logo', async ({ page }) => {
		await page.goto('/settings')

		// Click the logo/brand name
		await page.getByText('EchoSphere').click()

		await expect(page).toHaveURL('/')
	})
})
