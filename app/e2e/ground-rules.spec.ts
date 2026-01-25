import { test, expect } from '@playwright/test'

test.describe('Ground Rules Modal', () => {
	test('should show ground rules modal on first visit', async ({ page }) => {
		// Don't set localStorage - modal should appear
		await page.goto('/')

		// Check that the ground rules modal appears
		await expect(page.getByRole('dialog')).toBeVisible()
		await expect(page.getByText('Community Ground Rules')).toBeVisible()
	})

	test('should require all checkboxes before accepting', async ({ page }) => {
		await page.goto('/')

		// Modal should be visible
		await expect(page.getByRole('dialog')).toBeVisible()

		// Accept button should be disabled (grayed out) initially
		const acceptButton = page.getByRole('button', { name: /I Accept All Rules/i })
		await expect(acceptButton).toBeVisible()

		// Click accept without checking boxes
		await acceptButton.click()

		// Modal should still be visible (can't close without checking all boxes)
		await expect(page.getByRole('dialog')).toBeVisible()
	})

	test('should close modal after accepting all rules', async ({ page }) => {
		await page.goto('/')

		// Modal should be visible
		await expect(page.getByRole('dialog')).toBeVisible()

		// Check all the rule checkboxes
		await page.getByLabel(/No Hate or Harm/i).check()
		await page.getByLabel(/Be Respectful/i).check()
		await page.getByLabel(/Safe Environment/i).check()
		await page.getByLabel(/Be Awesome/i).check()

		// Click accept
		await page.getByRole('button', { name: /I Accept All Rules/i }).click()

		// Modal should be closed
		await expect(page.getByRole('dialog')).not.toBeVisible()

		// Login button should now be visible
		await expect(page.getByRole('button', { name: /login/i })).toBeVisible()
	})

	test('should not show modal on subsequent visits after accepting', async ({ page }) => {
		// Set up the accepted rules in localStorage
		await page.addInitScript(() => {
			localStorage.setItem(
				'ground-rules-accepted',
				JSON.stringify(['no-hate', 'be-respectful', 'safe-environment', 'be-awesome'])
			)
		})

		await page.goto('/')

		// Modal should NOT be visible
		await expect(page.getByText('Community Ground Rules')).not.toBeVisible()

		// Page should be accessible
		await expect(page.getByRole('button', { name: /login/i })).toBeVisible()
	})
})
