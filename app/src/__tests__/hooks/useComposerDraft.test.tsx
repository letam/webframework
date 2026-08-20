import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// What is covered here is the hook's decision-making — when a draft is written,
// and when writing is deliberately refused — so the storage layer is stubbed out.
// composerDraft.test.ts exercises the real IndexedDB implementation.
vi.mock('@/lib/utils/composerDraft', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/utils/composerDraft')>()
	return {
		...actual,
		loadComposerDraft: vi.fn().mockResolvedValue(null),
		saveComposerDraft: vi.fn().mockResolvedValue(undefined),
		clearComposerDraft: vi.fn().mockResolvedValue(undefined),
		updateComposerDraftFields: vi.fn().mockResolvedValue(undefined),
	}
})

import { useComposerDraft } from '@/hooks/useComposerDraft'
import { clearComposerDraft, saveComposerDraft } from '@/lib/utils/composerDraft'

const TEXT_DEBOUNCE_MS = 600

type Props = Parameters<typeof useComposerDraft>[0]

const props = (overrides: Partial<Props> = {}): Props => ({
	enabled: true,
	userId: null,
	text: '',
	visibility: 'public',
	mediaType: 'text',
	media: null,
	isEmpty: true,
	onRestore: vi.fn(),
	...overrides,
})

/** Let the debounce fire, plus the microtasks the restore read queues. */
const settle = async () => {
	await act(async () => {
		vi.advanceTimersByTime(TEXT_DEBOUNCE_MS)
	})
}

describe('useComposerDraft', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.mocked(saveComposerDraft).mockClear()
		vi.mocked(clearComposerDraft).mockClear()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('saves a signed-in draft once typing settles', async () => {
		const { rerender } = renderHook((p: Props) => useComposerDraft(p), {
			initialProps: props({ userId: 7 }),
		})

		rerender(props({ userId: 7, text: 'half a thought', isEmpty: false }))
		await settle()

		expect(saveComposerDraft).toHaveBeenCalledWith(
			7,
			expect.objectContaining({ text: 'half a thought' })
		)
	})

	it('refuses to copy a signed-out draft into the shared anonymous slot', async () => {
		const { rerender } = renderHook((p: Props) => useComposerDraft(p), {
			initialProps: props({ userId: 7, text: 'private words', isEmpty: false }),
		})

		rerender(props({ userId: null, text: 'private words', isEmpty: false }))
		await settle()

		expect(clearComposerDraft).toHaveBeenCalledWith(null)
		expect(saveComposerDraft).not.toHaveBeenCalledWith(null, expect.anything())
	})

	it('resumes saving after a logout and login with the composer still full', async () => {
		// The regression: the logout guard was only ever lifted by the composer going
		// empty, so signing back in with the same text left autosave dead for the rest
		// of the session — silently, which is the whole failure the feature prevents.
		const { rerender } = renderHook((p: Props) => useComposerDraft(p), {
			initialProps: props({ userId: 7, text: 'private words', isEmpty: false }),
		})

		rerender(props({ userId: null, text: 'private words', isEmpty: false }))
		await settle()
		vi.mocked(saveComposerDraft).mockClear()

		rerender(props({ userId: 7, text: 'private words', isEmpty: false }))
		await settle()

		expect(saveComposerDraft).toHaveBeenCalledWith(
			7,
			expect.objectContaining({ text: 'private words' })
		)
	})
})
