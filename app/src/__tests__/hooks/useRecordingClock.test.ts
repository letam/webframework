import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRecordingClock } from '@/hooks/useRecordingClock'
beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(0)
})
afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})
it('starts, pauses, resumes, and resets elapsed time', () => {
	const { result } = renderHook(() => useRecordingClock())
	act(() => result.current.start())
	act(() => vi.advanceTimersByTime(3000))
	expect(result.current.seconds).toBe(3)
	act(() => result.current.pause())
	act(() => vi.advanceTimersByTime(5000))
	expect(result.current.seconds).toBe(3)
	act(() => result.current.resume())
	act(() => vi.advanceTimersByTime(2000))
	expect(result.current.seconds).toBe(5)
	act(() => result.current.reset())
	expect(result.current.seconds).toBe(0)
	act(() => vi.advanceTimersByTime(3000))
	expect(result.current.seconds).toBe(0)
})
it('catches up after a background gap without interval ticks', () => {
	const { result } = renderHook(() => useRecordingClock())
	act(() => result.current.start())
	vi.setSystemTime(60_000)
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
	act(() => document.dispatchEvent(new Event('visibilitychange')))
	expect(result.current.seconds).toBe(60)
})
it('clears the interval on unmount', () => {
	const { result, unmount } = renderHook(() => useRecordingClock())
	act(() => result.current.start())
	expect(vi.getTimerCount()).toBe(1)
	unmount()
	expect(vi.getTimerCount()).toBe(0)
})
