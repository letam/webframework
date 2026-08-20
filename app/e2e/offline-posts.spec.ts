import { test, expect, type Page } from '@playwright/test'

const GROUND_RULES = ['no-hate', 'be-respectful', 'safe-environment', 'be-awesome']

// Pathname-anchored on purpose: a bare '**/api/**' glob would also match the Vite
// dev server's own module URLs (/src/lib/api/posts.ts) and abort the app itself.
const isBackendCall = (url: URL) =>
	url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')

// Route aborts alone leave navigator.onLine true, and dispatching only the event
// desyncs it from the flag — TanStack's onlineManager then pauses mutations while
// the composer still takes the online path. Real browsers flip both together, so
// the simulation must too.
const setNavigatorOnline = (page: Page, online: boolean) =>
	page.evaluate((value) => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
		window.dispatchEvent(new Event(value ? 'online' : 'offline'))
	}, online)

test.describe('Offline posts', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript((rules) => {
			localStorage.setItem('ground-rules-accepted', JSON.stringify(rules))
		}, GROUND_RULES)
	})

	test('persists a queued text post and syncs it after reconnect', async ({ page }) => {
		const postText = `Queued offline ${Date.now()}`
		await page.route(isBackendCall, (route) => route.abort())
		await page.goto('/')
		await setNavigatorOnline(page, false)

		await page.locator('[data-composer-input]').fill(postText)
		await page.getByRole('button', { name: 'Post' }).click()

		const outbox = page.getByTestId('outbox-list')
		await expect(outbox.getByText(postText)).toBeVisible()
		await expect(outbox.getByText('Queued', { exact: true })).toBeVisible()
		await expect(page.locator('[data-composer-input]')).toHaveValue('')
		await expect(
			page.getByLabel("You're offline — 1 post queued. It'll go out when you're back online.")
		).toBeVisible()

		await page.reload()
		await setNavigatorOnline(page, false)
		await expect(page.getByTestId('outbox-list').getByText(postText)).toBeVisible()

		await page.unroute(isBackendCall)
		await setNavigatorOnline(page, true)

		await expect(page.getByTestId('outbox-list')).not.toBeVisible({ timeout: 15_000 })
		await expect(page.locator('[data-testid^="post-"]').filter({ hasText: postText })).toBeVisible({
			timeout: 15_000,
		})
	})
})
