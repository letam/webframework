import { format } from 'date-fns'

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/**
 * Compact, feed-friendly relative time: "just now", "5m", "3h", "2d",
 * then calendar dates ("Jul 9", or "Jul 9, 2025" once the year differs).
 */
export const formatShortTime = (date: string | number | Date, now: Date = new Date()): string => {
	const then = new Date(date)
	const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)

	if (seconds < 45) {
		return 'just now'
	}
	if (seconds < HOUR) {
		return `${Math.max(1, Math.floor(seconds / MINUTE))}m`
	}
	if (seconds < DAY) {
		return `${Math.floor(seconds / HOUR)}h`
	}
	if (seconds < WEEK) {
		return `${Math.floor(seconds / DAY)}d`
	}
	if (then.getFullYear() === now.getFullYear()) {
		return format(then, 'MMM d')
	}
	return format(then, 'MMM d, yyyy')
}
