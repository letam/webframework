import { test, expect, type Page } from '@playwright/test'

// Focusing the composer expands it: Bold/Italic appear on the left of the
// toolbar and visibility/Draft on the right. With an empty input, the expansion
// used to hang on the textarea's own focus, so pressing any toolbar control blurred
// the textarea and collapsed the toolbar between pointerdown and click. The
// buttons slid sideways under the pointer and the click landed on the wrong one,
// or on nothing. Only a real browser lays out and hit-tests, so jsdom can't see it.

const GROUND_RULES = ['no-hate', 'be-respectful', 'safe-environment', 'be-awesome']

const isBackendCall = (url: URL) =>
	url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')

// Signed in, so the visibility control (which only exists while expanded) shows.
const stubSignedIn = async (page: Page) => {
	await page.route(isBackendCall, (route) => {
		const { pathname } = new URL(route.request().url())
		if (pathname === '/auth/status/') {
			return route.fulfill({
				json: { is_authenticated: true, user_id: 42, username: 'tester', avatar: null },
			})
		}
		if (pathname === '/api/posts/') {
			return route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } })
		}
		return route.fulfill({ json: {} })
	})
}

for (const input of ['mouse', 'touch'] as const) {
	test.describe(`Expanded empty composer (${input})`, () => {
		test.use(
			input === 'touch'
				? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
				: { viewport: { width: 1280, height: 800 } }
		)

		const press = (page: Page, name: string) => {
			const button = page.getByRole('button', { name, exact: true })
			return input === 'touch' ? button.tap() : button.click()
		}

		const expand = async (page: Page) => {
			await page.addInitScript((rules) => {
				localStorage.setItem('ground-rules-accepted', JSON.stringify(rules))
			}, GROUND_RULES)
			await stubSignedIn(page)
			await page.goto('/')
			const composer = page.locator('[data-composer-input]')
			if (input === 'touch') await composer.tap()
			else await composer.click()
			await expect(composer).toHaveValue('')
			await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible()
		}

		test('the record button opens the recorder', async ({ page }) => {
			await expand(page)
			await press(page, 'Record Audio')
			await expect(page.getByRole('dialog')).toBeVisible()
		})

		test('the visibility button opens its menu and stays expanded', async ({ page }) => {
			await expand(page)
			await press(page, 'Visibility')
			await expect(page.getByRole('menuitemradio', { name: /Public/ })).toBeVisible()
			await page.getByRole('menuitemradio', { name: /Public/ }).click()
			await expect(page.getByRole('menu')).not.toBeVisible()
			await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible()
		})

		test('the sync button opens its menu', async ({ page }) => {
			await expand(page)
			await press(page, 'Auto-sync')
			await expect(page.getByRole('menuitemradio', { name: /Sync automatically/ })).toBeVisible()
		})

		test('pressing outside the composer still collapses it', async ({ page }) => {
			await expand(page)
			// Empty page well below the composer and the feed's empty state.
			if (input === 'touch') await page.touchscreen.tap(195, 780)
			else await page.mouse.click(640, 760)
			await expect(page.getByRole('button', { name: 'Bold' })).not.toBeVisible()
		})

		test('tabbing out of the composer collapses it', async ({ page }) => {
			test.skip(input === 'touch', 'keyboard focus only')
			await expand(page)
			await page.keyboard.press('Shift+Tab')
			await expect(page.getByRole('button', { name: 'Bold' })).not.toBeVisible()
		})
	})
}
