import { describe, expect, it } from 'vitest'
import { parseDurationString } from '@/lib/utils/media'

describe('parseDurationString', () => {
	// Samples are verbatim django.utils.duration.duration_string output, which is what
	// DRF's DurationField sends for Media.duration.
	it.each([
		['00:00:05', 5],
		['00:01:30.500000', 90.5],
		['02:00:00', 7200],
		['1 01:00:03', 90_003],
	])('parses Django duration %s', (input, expected) => {
		expect(parseDurationString(input)).toBe(expected)
	})

	it.each([
		['1:30', 90],
		['0:01:30.5', 90.5],
		['12.25', 12.25],
		['0', 0],
	])('parses shorthand %s', (input, expected) => {
		expect(parseDurationString(input)).toBe(expected)
	})

	it.each([
		undefined,
		'',
		'a:b:c',
		'1:xx',
		'12abc',
		'-5',
		'-1 23:59:59',
		'Infinity',
		'1:2:3:4',
	])('returns 0 for unparseable %s', (input) => {
		expect(parseDurationString(input)).toBe(0)
	})
})
