// jsdom ships no IndexedDB, so the shim has to land before the module under
// test reads the global.
import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
	DRAFT_MAX_AGE_MS,
	clearComposerDraft,
	draftKeyForUser,
	loadComposerDraft,
	saveComposerDraft,
	updateComposerDraftFields,
} from '@/lib/utils/composerDraft'

const draft = (overrides: Partial<Parameters<typeof saveComposerDraft>[1]> = {}) => ({
	text: 'half a thought',
	visibility: 'public' as const,
	mediaType: 'text' as const,
	media: null,
	mediaName: null,
	mediaIsFile: false,
	...overrides,
})

beforeEach(() => {
	// A fresh factory per test, so one test's draft cannot leak into the next.
	globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
	vi.restoreAllMocks()
})

// Time is moved by stubbing Date.now, never with fake timers: IndexedDB
// delivers its results on real macrotasks, so faking the clock stalls every
// request and the test times out instead of failing.
const FIXED_NOW = 1_800_000_000_000

describe('draftKeyForUser', () => {
	it('separates the anonymous slot from a signed-in one', () => {
		expect(draftKeyForUser(null)).toBe('anon')
		expect(draftKeyForUser(7)).toBe('user:7')
	})
})

describe('composer draft storage', () => {
	it('round-trips text and visibility', async () => {
		await saveComposerDraft(7, draft({ text: 'unfinished', visibility: 'private' }))

		const stored = await loadComposerDraft(7)
		expect(stored?.text).toBe('unfinished')
		expect(stored?.visibility).toBe('private')
		expect(stored?.mediaOmitted).toBe(false)
	})

	it('returns null when nothing was ever saved', async () => {
		expect(await loadComposerDraft(7)).toBeNull()
	})

	// Binary fidelity is NOT asserted here, and cannot be: jsdom's Blob is not
	// recognised by structuredClone (it comes back as a plain object), so
	// fake-indexeddb cannot round-trip one no matter what the module does.
	// Browsers store Blobs in IndexedDB natively — that path is covered in
	// e2e/composer-draft.spec.ts, running against real Chromium.
	it('round-trips the media descriptors that travel alongside a recording', async () => {
		const recording = new Blob(['fake-audio'], { type: 'audio/webm' })
		await saveComposerDraft(7, draft({ mediaType: 'audio', media: recording }))

		const stored = await loadComposerDraft(7)
		expect(stored?.mediaType).toBe('audio')
		expect(stored?.mediaIsFile).toBe(false)
		expect(stored?.mediaOmitted).toBe(false)
	})

	it('remembers the filename of an uploaded file, which a Blob cannot carry', async () => {
		const upload = new File(['jpeg-bytes'], 'holiday.jpg', { type: 'image/jpeg' })
		await saveComposerDraft(7, {
			...draft({ mediaType: 'image', media: upload }),
			mediaName: upload.name,
			mediaIsFile: true,
		})

		const stored = await loadComposerDraft(7)
		expect(stored?.mediaIsFile).toBe(true)
		expect(stored?.mediaName).toBe('holiday.jpg')
	})

	it('keeps one user out of another user’s draft', async () => {
		await saveComposerDraft(1, draft({ text: 'mine' }))

		expect(await loadComposerDraft(2)).toBeNull()
		expect(await loadComposerDraft(null)).toBeNull()
		expect((await loadComposerDraft(1))?.text).toBe('mine')
	})

	it('stores an anonymous draft under its own key', async () => {
		await saveComposerDraft(null, draft({ text: 'signed out' }))

		expect((await loadComposerDraft(null))?.text).toBe('signed out')
		expect(await loadComposerDraft(1)).toBeNull()
	})

	it('discards a draft that has gone stale rather than resurrecting it', async () => {
		const now = vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)
		await saveComposerDraft(7, draft({ text: 'last month' }))

		now.mockReturnValue(FIXED_NOW + DRAFT_MAX_AGE_MS + 1)
		expect(await loadComposerDraft(7)).toBeNull()

		// And it is gone, not merely hidden: loading dropped it on the way past.
		now.mockReturnValue(FIXED_NOW)
		expect(await loadComposerDraft(7)).toBeNull()
	})

	it('keeps a draft that is still inside the window', async () => {
		const now = vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)
		await saveComposerDraft(7, draft({ text: 'yesterday' }))

		now.mockReturnValue(FIXED_NOW + DRAFT_MAX_AGE_MS - 1000)
		expect((await loadComposerDraft(7))?.text).toBe('yesterday')
	})

	it('repairs a database that already exists without its object store', async () => {
		// The state a half-applied upgrade — or another writer opening the name
		// first — leaves behind. Against a pinned DB_VERSION this never fires
		// onupgradeneeded, so the store is never built and every save afterwards
		// fails silently. Found by an e2e helper that raced the app to open().
		await new Promise<void>((resolve) => {
			const request = indexedDB.open('composer-drafts', 1)
			// Deliberately create no object store.
			request.onupgradeneeded = () => {}
			request.onsuccess = () => {
				request.result.close()
				resolve()
			}
		})

		await saveComposerDraft(7, draft({ text: 'survived the repair' }))
		expect((await loadComposerDraft(7))?.text).toBe('survived the repair')
	})

	it('clears on request', async () => {
		await saveComposerDraft(7, draft())
		await clearComposerDraft(7)

		expect(await loadComposerDraft(7)).toBeNull()
	})

	it('overwrites rather than accumulating', async () => {
		await saveComposerDraft(7, draft({ text: 'first' }))
		await saveComposerDraft(7, draft({ text: 'second' }))

		expect((await loadComposerDraft(7))?.text).toBe('second')
	})

	it('updates only the text fields, keeping the media descriptors intact', async () => {
		await saveComposerDraft(7, {
			...draft({ text: 'draft', visibility: 'public', mediaType: 'video' }),
			mediaName: 'clip.mp4',
			mediaIsFile: true,
		})

		await updateComposerDraftFields(7, {
			text: 'a caption, typed later',
			visibility: 'private',
			mediaType: 'video',
		})

		const stored = await loadComposerDraft(7)
		expect(stored?.text).toBe('a caption, typed later')
		expect(stored?.visibility).toBe('private')
		// The recording and its descriptors survive the text-only rewrite.
		expect(stored?.mediaName).toBe('clip.mp4')
		expect(stored?.mediaIsFile).toBe(true)
		expect(stored?.mediaOmitted).toBe(false)
	})

	it('writes a text-only record when there is nothing stored yet', async () => {
		await updateComposerDraftFields(7, {
			text: 'first keystrokes',
			visibility: 'public',
			mediaType: 'text',
		})

		const stored = await loadComposerDraft(7)
		expect(stored?.text).toBe('first keystrokes')
		expect(stored?.media).toBeNull()
	})
})

describe('when storage is unavailable', () => {
	// Private-mode Safari and hardened browser settings both land here. Losing a
	// draft is acceptable; throwing inside the composer is not.
	beforeEach(() => {
		// Deliberately remove the global the module guards on.
		globalThis.indexedDB = undefined as unknown as IDBFactory
	})

	it('saves, loads, and clears without throwing', async () => {
		await expect(saveComposerDraft(7, draft())).resolves.toBeUndefined()
		await expect(
			updateComposerDraftFields(7, { text: 'x', visibility: 'public', mediaType: 'text' })
		).resolves.toBeUndefined()
		await expect(loadComposerDraft(7)).resolves.toBeNull()
		await expect(clearComposerDraft(7)).resolves.toBeUndefined()
	})
})
