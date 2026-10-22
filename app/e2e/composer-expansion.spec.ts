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

		// Hold the mouse like a person does, so anything the press sets off (a blur, a
		// re-render) lands before the click.
		const tapOrClick = (locator: ReturnType<Page['locator']>) =>
			input === 'touch' ? locator.tap() : locator.click({ delay: 100 })

		const press = (page: Page, name: string) =>
			tapOrClick(page.getByRole('button', { name, exact: true }))

		const expand = async (page: Page) => {
			await page.addInitScript((rules) => {
				localStorage.setItem('ground-rules-accepted', JSON.stringify(rules))
			}, GROUND_RULES)
			await stubSignedIn(page)
			await page.goto('/')
			const composer = page.locator('[data-composer-input]')
			await tapOrClick(composer)
			await expect(composer).toHaveValue('')
			await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible()
		}

		test('the record button opens the recorder', async ({ page }) => {
			await expand(page)
			await press(page, 'Record Audio')
			await expect(page.getByRole('dialog')).toBeVisible()
		})

		// Safari (macOS and iOS) doesn't focus a button on click, so its default
		// mousedown action blurs the textarea with focus going nowhere, the same blur
		// that Escape causes. Chromium focuses the button, so emulate Safari: unless the
		// page prevented the default, drop focus on mousedown and keep it off the button.
		// Run after the page's handlers, like the browser's default action.
		test('the record button opens the recorder when buttons take no focus', async ({ page }) => {
			await page.addInitScript(() => {
				window.addEventListener('mousedown', (event) => {
					if (!(event.target as Element).closest('button')) return
					if (event.defaultPrevented) return
					event.preventDefault()
					;(document.activeElement as HTMLElement | null)?.blur()
				})
			})
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
			// The feed's empty state: plain text, below the composer.
			await tapOrClick(page.getByText(/Be the first to say something/))
			await expect(page.getByRole('button', { name: 'Bold' })).not.toBeVisible()
		})

		// Scrolling the feed with a finger moves no focus, and the keyboard stays up. What
		// matters is a touch outside that drags and lifts without a click; whether the
		// page actually scrolls varies by platform, so don't assert it.
		test('dragging a finger outside it does not collapse it', async ({ page, browserName }) => {
			test.skip(input !== 'touch', 'touch only')
			test.skip(browserName !== 'chromium', 'needs the Chrome DevTools Protocol')
			await expand(page)
			await page.evaluate(() => {
				const seen: string[] = []
				;(window as unknown as { touchEvents: string[] }).touchEvents = seen
				for (const type of ['pointerdown', 'click']) {
					window.addEventListener(type, () => seen.push(type), true)
				}
			})
			const outside = await page.getByText(/Be the first to say something/).boundingBox()
			if (!outside) throw new Error('empty state has no layout box')
			const x = outside.x + outside.width / 2
			const y = outside.y + outside.height / 2
			const cdp = await page.context().newCDPSession(page)
			const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dy = 0) =>
				cdp.send('Input.dispatchTouchEvent', {
					type,
					touchPoints: type === 'touchEnd' ? [] : [{ x, y: y - dy }],
				})
			await touch('touchStart')
			for (const dy of [20, 60, 120, 200]) await touch('touchMove', dy)
			await touch('touchEnd')
			await expect
				.poll(() =>
					page.evaluate(() => (window as unknown as { touchEvents: string[] }).touchEvents)
				)
				.toEqual(['pointerdown'])
			await expect(page.locator('[data-composer-input]')).toBeFocused()
			await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible()
		})

		test('Escape collapses it', async ({ page }) => {
			test.skip(input === 'touch', 'keyboard only')
			await expand(page)
			await page.keyboard.press('Escape')
			await expect(page.locator('[data-composer-input]')).not.toBeFocused()
			await expect(page.getByRole('button', { name: 'Bold' })).not.toBeVisible()
		})

		// What the iOS keyboard's Done button does: focus goes nowhere, with no press
		// or focus move outside to see.
		test('a blur with nowhere for focus to go collapses it', async ({ page }) => {
			await expand(page)
			await page.locator('[data-composer-input]').evaluate((el: HTMLElement) => el.blur())
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
