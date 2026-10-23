import { test, expect, type Page } from '@playwright/test'

const GROUND_RULES = ['no-hate', 'be-respectful', 'safe-environment', 'be-awesome']

// The backend's WAVEFORM_BUCKETS. The bar count is what made the waveform row
// overflow phones, so the stub must match production's.
const WAVEFORM_BUCKETS = 120

const audioPost = (id: number) => ({
	id,
	url: `/p/${id}/`,
	created: '2026-10-01T12:00:00Z',
	modified: '2026-10-01T12:00:00Z',
	author: { id: 2, username: 'anonymous', first_name: '', last_name: '', avatar: null },
	head: '',
	body: `Audio post ${id}`,
	media: {
		id,
		media_type: 'audio',
		mime_type: 'audio/mpeg',
		extension: 'mp3',
		signed_url: null,
		duration: '0:00:01.500000',
		waveform: Array.from({ length: WAVEFORM_BUCKETS }, (_, i) => 20 + ((i * 37) % 80)),
		created: '2026-10-01T12:00:00Z',
		modified: '2026-10-01T12:00:00Z',
	},
	link_previews: [],
	post_set: [],
	visibility: 'public',
	is_draft: false,
	link_previews_enabled: true,
	pinned_at: null,
	share_token: null,
	like_count: 0,
	comment_count: 0,
	view_count: 0,
	liked: false,
})

// Pathname-matched, not a '**/api/**' glob, so Vite's own /src/lib/api/ modules
// are left alone (see offline-posts.spec.ts). Only the feed list is stubbed.
const stubAudioFeed = (page: Page) =>
	page.route(
		(url) => url.pathname === '/api/posts/',
		(route) => {
			if (route.request().method() !== 'GET') {
				return route.fallback()
			}
			return route.fulfill({
				json: { next: null, previous: null, results: [1, 2, 3].map(audioPost) },
			})
		}
	)

const phones = [
	{ width: 320, height: 568 },
	{ width: 390, height: 844 },
]

for (const viewport of phones) {
	test.describe(`Feed at ${viewport.width}x${viewport.height}`, () => {
		test.use({ viewport, hasTouch: true, isMobile: true })

		test('audio posts do not scroll the page sideways', async ({ page }) => {
			await page.addInitScript((rules) => {
				localStorage.setItem('ground-rules-accepted', JSON.stringify(rules))
			}, GROUND_RULES)
			await stubAudioFeed(page)
			await page.goto('/')

			const waveforms = page.getByRole('slider', { name: 'Audio waveform progress' })
			await expect(waveforms).toHaveCount(3)

			const { scrollWidth, clientWidth } = await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				clientWidth: document.documentElement.clientWidth,
			}))
			expect(scrollWidth).toBe(clientWidth)

			// The duration readout, the row's last child, must stay on screen.
			const duration = page.getByTestId('post-1').getByText('0:01', { exact: true }).last()
			const box = await duration.boundingBox()
			expect(box).not.toBeNull()
			expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width)
		})
	})
}

const groundRulesViewports = [
	{ width: 375, height: 667 },
	{ width: 320, height: 568 },
]

for (const viewport of groundRulesViewports) {
	test.describe(`Ground rules at ${viewport.width}x${viewport.height}`, () => {
		test.use({ viewport, hasTouch: true, isMobile: true })

		test('the Accept button is on screen and clickable', async ({ page }) => {
			await page.goto('/')
			const dialog = page.getByRole('dialog')
			await expect(dialog).toBeVisible()
			// Let the zoom-in finish first: mid-animation the dialog is scaled to 95%,
			// which is just enough for an overflowing one to look like it fits.
			await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))

			// The whole dialog, header included, must fit: a centered fixed dialog
			// taller than the screen spills off the top and bottom, and neither the
			// page nor the dialog scrolls to reach those parts.
			const box = await dialog.boundingBox()
			expect(box).not.toBeNull()
			expect(box?.y ?? -1).toBeGreaterThanOrEqual(0)
			expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height)

			for (const rule of [
				/No Hate or Harm/i,
				/Be Respectful/i,
				/Safe Environment/i,
				/Be Awesome/i,
			]) {
				await page.getByLabel(rule).check()
			}

			const accept = page.getByRole('button', { name: /I Accept All Rules/i })
			// toBeInViewport, not toBeVisible: an overflowing dialog still renders the
			// button, just below the fold where a phone user cannot scroll to it.
			await expect(accept).toBeInViewport({ ratio: 1 })
			await accept.click()

			await expect(dialog).not.toBeVisible()
		})
	})
}
