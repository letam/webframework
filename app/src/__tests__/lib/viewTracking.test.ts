import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { recordPostViews } from '@/lib/api/posts'
import { __resetViewTrackingForTests, markPostViewed } from '@/lib/viewTracking'

vi.mock('@/lib/api/posts', () => ({
	recordPostViews: vi.fn(),
}))

const setVisibilityState = (visibilityState: DocumentVisibilityState) => {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		value: visibilityState,
	})
}

describe('viewTracking', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.clearAllMocks()
		__resetViewTrackingForTests()
		setVisibilityState('visible')
	})

	afterEach(() => {
		__resetViewTrackingForTests()
		vi.useRealTimers()
	})

	it('dedupes ids per page lifetime and flushes after four seconds', () => {
		markPostViewed(1)
		markPostViewed(1)

		vi.advanceTimersByTime(3_999)
		expect(recordPostViews).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		expect(recordPostViews).toHaveBeenCalledTimes(1)
		expect(recordPostViews).toHaveBeenCalledWith([1])
	})

	it('resets the quiet timer when new ids are marked', () => {
		markPostViewed(1)
		vi.advanceTimersByTime(2_000)
		markPostViewed(2)

		vi.advanceTimersByTime(3_999)
		expect(recordPostViews).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		expect(recordPostViews).toHaveBeenCalledWith([1, 2])
	})

	it('flushes immediately when the page is hidden', () => {
		markPostViewed(3)
		setVisibilityState('hidden')

		document.dispatchEvent(new Event('visibilitychange'))

		expect(recordPostViews).toHaveBeenCalledWith([3])
	})
})
