import { test, expect, type Page } from '@playwright/test'

// The composer's toolbar grows when the input is focused (formatting buttons on
// the left; visibility and Draft on the right). On a phone-width card that row
// used to overflow, pushing the Post button past the card's right edge and off
// screen. jsdom has no layout, so only a real browser can check this.

const GROUND_RULES = ['no-hate', 'be-respectful', 'safe-environment', 'be-awesome']

const isBackendCall = (url: URL) =>
	url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')

// Signed in shows the most toolbar controls (visibility + Draft), so it is the
// tightest layout. Stub the API so no backend is needed.
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

const LONG_TEXT = 'A long thought that keeps going and going. '.repeat(30)

const expectPostButtonOnScreen = async (page: Page) => {
	const post = page.getByRole('button', { name: 'Post', exact: true })
	await expect(post).toBeVisible()
	await expect(post).toBeInViewport({ ratio: 1 })
	const viewportWidth = page.viewportSize()?.width ?? 0
	const box = await post.boundingBox()
	if (!box) throw new Error('Post button has no layout box')
	expect(box.x).toBeGreaterThanOrEqual(0)
	expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth)
	// No horizontal page scroll either.
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	)
	expect(overflow).toBeLessThanOrEqual(0)
}

for (const [name, viewport] of [
	['phone', { width: 390, height: 844 }],
	['small phone', { width: 320, height: 568 }],
	['desktop', { width: 1280, height: 800 }],
] as const) {
	test.describe(`Composer layout (${name})`, () => {
		test.use({ viewport })

		test.beforeEach(async ({ page }) => {
			await page.addInitScript((rules) => {
				localStorage.setItem('ground-rules-accepted', JSON.stringify(rules))
			}, GROUND_RULES)
			await stubSignedIn(page)
		})

		test('keeps the Post button on screen while typing', async ({ page }) => {
			await page.goto('/')
			const input = page.locator('[data-composer-input]')
			await input.click()
			await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible()
			await expectPostButtonOnScreen(page)

			await input.fill(LONG_TEXT)
			await expect(page.getByRole('button', { name: 'Draft' })).toBeVisible()
			await expectPostButtonOnScreen(page)
		})
	})
}
