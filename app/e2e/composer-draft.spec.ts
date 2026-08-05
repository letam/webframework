import { test, expect, type Page } from '@playwright/test'

// The composer's autosave is the one feature whose whole point is surviving a
// page teardown, so a real browser is the only place it can be proven. jsdom
// cannot: its Blob is not recognised by structuredClone, so the unit tests in
// src/__tests__/lib/utils/composerDraft.test.ts assert the metadata and leave
// the bytes to this file.

const GROUND_RULES = ['no-hate', 'be-respectful', 'safe-environment', 'be-awesome']

// A 1x1 PNG. Small enough to inline, real enough that the browser decodes it —
// which is what makes naturalWidth a genuine check on the stored bytes.
const PNG_1X1 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// Read the stored draft from the page. Kept separate from the polling so it can
// run through page.evaluate, which awaits the promise — page.waitForFunction
// does NOT: it sees the returned Promise object, calls it truthy, and resolves
// on the first tick. Polled that way the helper reported "saved" before the
// debounce had written anything, and every restore assertion failed against a
// database that was still empty.
const readStoredDraft = (page: Page) =>
	page.evaluate(
		() =>
			// Check the database exists before opening it: `indexedDB.open` with no
			// version CREATES an empty, storeless one, and an observer must not
			// bring into being the thing it is checking for.
			indexedDB
				.databases()
				.then((databases) => {
					if (!databases.some((database) => database.name === 'composer-drafts')) return false

					return new Promise<boolean>((resolve) => {
						const request = indexedDB.open('composer-drafts')
						request.onsuccess = () => {
							const db = request.result
							if (!db.objectStoreNames.contains('drafts')) {
								db.close()
								resolve(false)
								return
							}
							const get = db.transaction('drafts').objectStore('drafts').get('anon')
							get.onsuccess = () => {
								db.close()
								resolve(!!get.result)
							}
							get.onerror = () => {
								db.close()
								resolve(false)
							}
						}
						request.onerror = () => resolve(false)
					})
				}),
		undefined
	)

/**
 * Wait until the draft has actually reached IndexedDB.
 *
 * Text saves are debounced, so a fixed sleep would either be flaky or slow.
 * Polling the store directly also pins the storage contract: if the database,
 * store, or key name changes, this fails loudly rather than passing on a race.
 */
const draftStored = async (page: Page) => {
	await expect.poll(() => readStoredDraft(page), { timeout: 10000 }).toBe(true)
}

test.describe('Composer draft autosave', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript((rules) => {
			localStorage.setItem('ground-rules-accepted', JSON.stringify(rules))
		}, GROUND_RULES)
	})

	test('restores unposted text after a reload', async ({ page }) => {
		await page.goto('/')
		await page.locator('[data-composer-input]').fill('a thought I have not posted yet')
		await draftStored(page)

		await page.reload()

		await expect(page.locator('[data-composer-input]')).toHaveValue(
			'a thought I have not posted yet'
		)
		await expect(page.getByText('Restored your unsaved draft.')).toBeVisible()
	})

	test('keeps an attached image across a reload, bytes intact', async ({ page }) => {
		await page.goto('/')
		await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
			name: 'holiday.png',
			mimeType: 'image/png',
			buffer: Buffer.from(PNG_1X1, 'base64'),
		})
		await expect(page.getByAltText('holiday.png')).toBeVisible()
		await draftStored(page)

		await page.reload()

		const restored = page.getByAltText('holiday.png')
		await expect(restored).toBeVisible()
		// Visibility alone would pass on a broken image — alt text renders either
		// way. Decoding is what proves the stored bytes came back whole.
		await expect
			.poll(() =>
				restored.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)
			)
			.toBe(true)
	})

	test('discarding a restored draft forgets it for good', async ({ page }) => {
		await page.goto('/')
		await page.locator('[data-composer-input]').fill('regrettable')
		await draftStored(page)

		await page.reload()
		await expect(page.getByText('Restored your unsaved draft.')).toBeVisible()
		await page.getByRole('button', { name: 'Discard' }).click()
		await expect(page.locator('[data-composer-input]')).toHaveValue('')

		// The point of Discard is that it survives the next reload too.
		await page.reload()
		await expect(page.locator('[data-composer-input]')).toHaveValue('')
		await expect(page.getByText('Restored your unsaved draft.')).not.toBeVisible()
	})

	test('leaves the composer alone when autosave is switched off', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('app-settings', JSON.stringify({ saveComposerDrafts: false }))
		})
		await page.goto('/')
		await page.locator('[data-composer-input]').fill('should not come back')
		// No draftStored() wait here: nothing should ever be written.
		await page.waitForTimeout(1500)

		await page.reload()

		await expect(page.locator('[data-composer-input]')).toHaveValue('')
	})
})
