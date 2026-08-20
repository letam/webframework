import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOutbox } from '@/hooks/useOutbox'
import { __resetOutboxForTests, enqueuePost } from '@/lib/outbox'
import type { OutboxEntry } from '@/lib/utils/outboxDb'

const authValue = vi.hoisted(() => ({
	current: { isAuthenticated: false, userId: null as number | null },
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue.current }))

vi.mock('@/lib/utils/outboxDb', () => ({
	loadOutboxEntries: vi.fn(async () => []),
	saveOutboxEntry: vi.fn(async () => true),
	deleteOutboxEntry: vi.fn(async () => true),
}))

const setOnline = (online: boolean) => {
	Object.defineProperty(navigator, 'onLine', { configurable: true, value: online })
}

const enqueueFor = (author: OutboxEntry['author'], text: string) =>
	enqueuePost({
		author,
		text,
		visibility: null,
		isDraft: false,
		linkPreviewsEnabled: true,
		autoTranscribe: false,
		mediaType: null,
		media: null,
		mediaName: null,
	})

// These tests run the real engine and the real useOutbox hook: they exist to
// catch a regression where the display-side visibility filter is dropped and
// one session's queued posts show up in another session's outbox.
describe('useOutbox visibility filtering', () => {
	beforeEach(() => {
		__resetOutboxForTests()
		setOnline(false)
	})

	afterEach(() => {
		__resetOutboxForTests()
		setOnline(true)
	})

	it('shows an authenticated user their own and unknown entries only', async () => {
		await enqueueFor(1, 'Mine')
		await enqueueFor(2, 'Someone else')
		await enqueueFor('anon', 'Anonymous')
		await enqueueFor('unknown', 'Unknown session')
		authValue.current = { isAuthenticated: true, userId: 1 }

		const { result } = renderHook(() => useOutbox())

		expect(result.current.entries.map((entry) => entry.text)).toEqual(['Mine', 'Unknown session'])
	})

	it('shows a signed-out session anonymous and unknown entries only', async () => {
		await enqueueFor(1, 'Mine')
		await enqueueFor('anon', 'Anonymous')
		await enqueueFor('unknown', 'Unknown session')
		authValue.current = { isAuthenticated: false, userId: null }

		const { result } = renderHook(() => useOutbox())

		expect(result.current.entries.map((entry) => entry.text)).toEqual([
			'Anonymous',
			'Unknown session',
		])
	})
})
