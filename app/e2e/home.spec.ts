import { test, expect } from '@playwright/test'

test.describe('Home Page', () => {
	test.beforeEach(async ({ page }) => {
		// Bypass the ground rules modal by setting localStorage
		await page.addInitScript(() => {
			localStorage.setItem(
				'ground-rules-accepted',
				JSON.stringify(['no-hate', 'be-respectful', 'safe-environment', 'be-awesome'])
			)
		})
	})

	test('should display the homepage with navbar', async ({ page }) => {
		await page.goto('/')

		// Check the navbar is present with the app name
		await expect(page.getByText('EchoSphere')).toBeVisible()

		// Check navigation links are visible (desktop)
		await expect(page.getByRole('link', { name: /home/i })).toBeVisible()
		await expect(page.getByRole('link', { name: /settings/i })).toBeVisible()
	})

	test('should display login and signup buttons when not authenticated', async ({ page }) => {
		await page.goto('/')

		// Check auth buttons are visible
		await expect(page.getByRole('button', { name: /login/i })).toBeVisible()
		await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible()
	})

	test('should display the feed section', async ({ page }) => {
		await page.goto('/')

		// Wait for the page to load and check for feed container
		// The feed area exists under the max-w-2xl mx-auto container
		await expect(page.locator('.max-w-2xl.mx-auto').first()).toBeVisible({ timeout: 10000 })
	})

	test('should navigate to settings page', async ({ page }) => {
		await page.goto('/')

		await page.getByRole('link', { name: /settings/i }).click()

		await expect(page).toHaveURL('/settings')
	})

	test('should toggle theme', async ({ page }) => {
		await page.goto('/')

		// Find the theme toggle button
		const themeToggle = page.getByRole('button', { name: /toggle theme/i })
		await expect(themeToggle).toBeVisible()

		// Check initial state - html should have a class (light or dark)
		const html = page.locator('html')

		// Click to open dropdown, then click a specific theme option
		await themeToggle.click()

		// Wait for dropdown and click dark theme
		await page.getByRole('menuitem', { name: /dark/i }).click()

		// Verify theme changed to dark
		await expect(html).toHaveClass(/dark/)
	})
})
