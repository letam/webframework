import { describe, expect, it } from 'vitest'
import { formatShortTime } from '@/lib/utils/time'

describe('formatShortTime', () => {
	const now = new Date('2026-07-09T12:00:00Z')

	it('returns "just now" under 45 seconds', () => {
		expect(formatShortTime(new Date('2026-07-09T11:59:30Z'), now)).toBe('just now')
	})

	it('returns minutes under an hour', () => {
		expect(formatShortTime(new Date('2026-07-09T11:55:00Z'), now)).toBe('5m')
		expect(formatShortTime(new Date('2026-07-09T11:59:00Z'), now)).toBe('1m')
	})

	it('returns hours under a day', () => {
		expect(formatShortTime(new Date('2026-07-09T09:00:00Z'), now)).toBe('3h')
	})

	it('returns days under a week', () => {
		expect(formatShortTime(new Date('2026-07-07T12:00:00Z'), now)).toBe('2d')
	})

	it('returns a calendar date beyond a week in the same year', () => {
		expect(formatShortTime(new Date('2026-05-01T12:00:00Z'), now)).toBe('May 1')
	})

	it('includes the year for older dates', () => {
		expect(formatShortTime(new Date('2025-12-31T12:00:00Z'), now)).toBe('Dec 31, 2025')
	})

	it('accepts ISO strings', () => {
		expect(formatShortTime('2026-07-09T11:00:00Z', now)).toBe('1h')
	})
})
