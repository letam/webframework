import { recordPostViews } from '@/lib/api/posts'

const FLUSH_DELAY_MS = 4_000

const pending = new Set<number>()
const reported = new Set<number>()
let flushTimer: number | undefined
let visibilityListenerAttached = false

const clearFlushTimer = () => {
	if (flushTimer !== undefined) {
		window.clearTimeout(flushTimer)
		flushTimer = undefined
	}
}

const flushPendingPostViews = () => {
	clearFlushTimer()

	if (pending.size === 0) {
		return
	}

	const ids = Array.from(pending)
	pending.clear()
	void recordPostViews(ids)
}

const handleVisibilityChange = () => {
	if (document.visibilityState === 'hidden') {
		flushPendingPostViews()
	}
}

const ensureVisibilityListener = () => {
	if (visibilityListenerAttached || typeof document === 'undefined') {
		return
	}

	document.addEventListener('visibilitychange', handleVisibilityChange)
	visibilityListenerAttached = true
}

const scheduleFlush = () => {
	clearFlushTimer()
	flushTimer = window.setTimeout(flushPendingPostViews, FLUSH_DELAY_MS)
}

export const markPostViewed = (id: number) => {
	if (reported.has(id)) {
		return
	}

	ensureVisibilityListener()
	reported.add(id)
	pending.add(id)
	scheduleFlush()
}

export const __resetViewTrackingForTests = () => {
	clearFlushTimer()
	pending.clear()
	reported.clear()
	if (visibilityListenerAttached && typeof document !== 'undefined') {
		document.removeEventListener('visibilitychange', handleVisibilityChange)
		visibilityListenerAttached = false
	}
}
