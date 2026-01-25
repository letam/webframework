import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
	test.beforeEach(async ({ page }) => {
		// Bypass the ground rules modal by setting localStorage
		await page.addInitScript(() => {
			localStorage.setItem(
				'ground-rules-accepted',
				JSON.stringify(['no-hate', 'be-respectful', 'safe-environment', 'be-awesome'])
			)
		})
	})

	test('should open login modal when clicking Login button', async ({ page }) => {
		await page.goto('/')

		// Click the login button
		await page.getByRole('button', { name: /login/i }).click()

		// Check that the login modal/dialog appears
		await expect(page.getByRole('dialog')).toBeVisible()
		await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()
	})

	test('should open signup modal when clicking Sign Up button', async ({ page }) => {
		await page.goto('/')

		// Click the signup button
		await page.getByRole('button', { name: /sign up/i }).click()

		// Check that the signup modal/dialog appears
		await expect(page.getByRole('dialog')).toBeVisible()
		await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible()
	})

	test('should close modal when pressing escape', async ({ page }) => {
		await page.goto('/')

		// Open login modal
		await page.getByRole('button', { name: /login/i }).click()
		await expect(page.getByRole('dialog')).toBeVisible()

		// Press escape to close
		await page.keyboard.press('Escape')

		// Modal should be closed
		await expect(page.getByRole('dialog')).not.toBeVisible()
	})

	test('login modal should have username and password fields', async ({ page }) => {
		await page.goto('/')

		// Open login modal
		await page.getByRole('button', { name: /login/i }).click()
		await expect(page.getByRole('dialog')).toBeVisible()

		// Check form fields exist
		await expect(page.getByLabel(/username/i)).toBeVisible()
		await expect(page.getByLabel(/password/i)).toBeVisible()
		await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
	})

	test('signup modal should have all required fields', async ({ page }) => {
		await page.goto('/')

		// Open signup modal
		await page.getByRole('button', { name: /sign up/i }).click()
		await expect(page.getByRole('dialog')).toBeVisible()

		// Check form fields exist
		await expect(page.getByLabel(/^username$/i)).toBeVisible()
		await expect(page.getByLabel(/^password$/i)).toBeVisible()
		await expect(page.getByLabel(/confirm password/i)).toBeVisible()
		await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
	})
})
