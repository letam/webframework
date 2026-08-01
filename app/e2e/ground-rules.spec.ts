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

		// Accept button should present as disabled (grayed out) initially
		const acceptButton = page.getByRole('button', { name: /I Accept All Rules/i })
		await expect(acceptButton).toBeVisible()
		await expect(acceptButton).toHaveAttribute('aria-disabled', 'true')

		// Activate accept without checking boxes, to assert the "check all boxes" hint.
		//
		// Keyboard, not a forced click. The button carries aria-disabled while staying
		// activatable, so `click()` is rejected by the enabled actionability check and
		// needs `force: true` — which skips the visible/enabled/stable and hit-target
		// checks and clicks a point computed right before input. With the stability
		// check gone the click can land at coordinates measured while Radix's dialog
		// is still animating in, hitting a rule's checkbox label instead of the button:
		// handleAccept never runs, hasAttemptedAccept stays false, the hint never
		// renders, and the failure surfaces as a stray checkbox ticked in the snapshot.
		//
		// press() needs no force here and targets the focused element rather than a
		// coordinate, so the animation cannot misdirect it — and it covers keyboard
		// activation of the hint for free. Measured over 10 runs at default workers,
		// which is where this reproduces: 2/10 misclicks with the forced click, 0/10
		// with press(). CI pins workers to 1 and never hit it.
		await acceptButton.press('Enter')

		// Modal should still be visible (can't close without checking all boxes)
		await expect(page.getByRole('dialog')).toBeVisible()
		await expect(page.getByText(/please check all boxes/i)).toBeVisible()
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
