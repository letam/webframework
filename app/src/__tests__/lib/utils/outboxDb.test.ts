import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
	claimOutboxEntryForSend,
	deleteOutboxEntry,
	getOutboxEntry,
	inspectOutboxEntry,
	loadOutboxEntries,
	removeOutboxEntryIfIdle,
	saveOutboxEntry,
	type OutboxEntry,
} from '@/lib/utils/outboxDb'

const FIXED_NOW = 1_800_000_000_000

const makeEntry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
	id: crypto.randomUUID(),
	createdAt: Date.now(),
	author: 7,
	status: 'queued',
	attempts: 0,
	lastError: null,
	text: 'Queued words',
	visibility: 'private',
	isDraft: false,
	linkPreviewsEnabled: true,
	autoTranscribe: false,
	mediaType: null,
	media: null,
	mediaName: null,
	...overrides,
})

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('outbox storage', () => {
	it('round-trips, updates, and deletes an entry', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)
		const entry = makeEntry()

		expect(await saveOutboxEntry(entry)).toBe(true)
		expect(await getOutboxEntry(entry.id)).toEqual(entry)

		const failed = { ...entry, status: 'failed' as const, lastError: 'Try again.' }
		expect(await saveOutboxEntry(failed)).toBe(true)
		expect(await getOutboxEntry(entry.id)).toEqual(failed)

		expect(await deleteOutboxEntry(entry.id)).toBe(true)
		expect(await getOutboxEntry(entry.id)).toBeNull()
	})

	it('round-trips media metadata', async () => {
		const media = new Blob(['queued image'], { type: 'image/png' })
		const entry = makeEntry({
			media,
			mediaType: 'image',
			mediaName: 'queued.png',
		})

		expect(await saveOutboxEntry(entry)).toBe(true)
		const [loaded] = await loadOutboxEntries()

		expect(loaded?.mediaType).toBe('image')
		expect(loaded?.mediaName).toBe('queued.png')
		// Byte fidelity is covered by e2e because fake-indexeddb under jsdom does not preserve Blob
		// contents; this unit test deliberately pins only the Blob's outbox metadata.
	})

	it('atomically claims only an existing queued entry for sending', async () => {
		const entry = makeEntry()
		await saveOutboxEntry(entry)

		await expect(claimOutboxEntryForSend(entry.id)).resolves.toEqual({
			status: 'claimed',
			entry: { ...entry, status: 'sending' },
		})
		await expect(claimOutboxEntryForSend(entry.id)).resolves.toEqual({
			status: 'not-queued',
			entry: { ...entry, status: 'sending' },
		})
		await expect(claimOutboxEntryForSend('removed-in-another-tab')).resolves.toEqual({
			status: 'missing',
		})
	})

	it('atomically refuses to remove a sending entry', async () => {
		const entry = makeEntry({ status: 'sending' })
		await saveOutboxEntry(entry)

		await expect(removeOutboxEntryIfIdle(entry.id)).resolves.toEqual({
			status: 'sending',
			entry,
		})
		expect(await getOutboxEntry(entry.id)).toEqual(entry)
	})

	it('atomically removes idle entries and reports missing rows', async () => {
		const entry = makeEntry()
		await saveOutboxEntry(entry)

		await expect(removeOutboxEntryIfIdle(entry.id)).resolves.toEqual({ status: 'removed' })
		await expect(removeOutboxEntryIfIdle(entry.id)).resolves.toEqual({ status: 'missing' })
	})

	it('distinguishes found, missing, and unavailable reads', async () => {
		const entry = makeEntry()
		await saveOutboxEntry(entry)

		await expect(inspectOutboxEntry(entry.id)).resolves.toEqual({ status: 'found', entry })
		await expect(inspectOutboxEntry('missing')).resolves.toEqual({ status: 'missing' })
		globalThis.indexedDB = undefined as unknown as IDBFactory
		await expect(inspectOutboxEntry(entry.id)).resolves.toEqual({ status: 'unavailable' })
	})

	it('recovers sending entries to queued on load', async () => {
		const entry = makeEntry({ status: 'sending' })
		await saveOutboxEntry(entry)

		const [loaded] = await loadOutboxEntries()

		expect(loaded.status).toBe('queued')
		expect((await getOutboxEntry(entry.id))?.status).toBe('queued')
	})

	it('lists entries oldest first', async () => {
		const now = vi.spyOn(Date, 'now')
		now.mockReturnValue(FIXED_NOW + 20)
		const newest = makeEntry({ text: 'Newest' })
		now.mockReturnValue(FIXED_NOW)
		const oldest = makeEntry({ text: 'Oldest' })
		now.mockReturnValue(FIXED_NOW + 10)
		const middle = makeEntry({ text: 'Middle' })

		await saveOutboxEntry(newest)
		await saveOutboxEntry(oldest)
		await saveOutboxEntry(middle)

		expect((await loadOutboxEntries()).map((entry) => entry.text)).toEqual([
			'Oldest',
			'Middle',
			'Newest',
		])
	})

	it('reports enqueue storage failure when IndexedDB is unavailable', async () => {
		globalThis.indexedDB = undefined as unknown as IDBFactory

		expect(await saveOutboxEntry(makeEntry())).toBe(false)
		expect(await claimOutboxEntryForSend('missing')).toEqual({ status: 'unavailable' })
		expect(await removeOutboxEntryIfIdle('missing')).toEqual({ status: 'unavailable' })
		expect(await loadOutboxEntries()).toEqual([])
	})
})
