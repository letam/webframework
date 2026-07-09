import { describe, expect, it } from 'vitest'
import { groupPostsByDate } from '@/utils/postGroups'
import { makePost } from '../data/mockPosts'

describe('groupPostsByDate', () => {
	it('returns no groups for empty input', () => {
		expect(groupPostsByDate([], 'weeks')).toEqual([])
		expect(groupPostsByDate([], 'months')).toEqual([])
	})

	it('buckets posts by Monday-starting weeks', () => {
		const monday = makePost({ id: 1, created: new Date('2026-07-06T12:00:00Z') })
		const sunday = makePost({ id: 2, created: new Date('2026-07-12T12:00:00Z') })
		const nextMonday = makePost({ id: 3, created: new Date('2026-07-13T12:00:00Z') })

		expect(groupPostsByDate([monday, sunday, nextMonday], 'weeks')).toEqual([
			{ label: 'Week of Jul 6, 2026', posts: [monday, sunday] },
			{ label: 'Week of Jul 13, 2026', posts: [nextMonday] },
		])
	})

	it('buckets posts by month', () => {
		const july = makePost({ id: 1, created: new Date('2026-07-09T12:00:00Z') })
		const august = makePost({ id: 2, created: new Date('2026-08-01T12:00:00Z') })

		expect(groupPostsByDate([july, august], 'months')).toEqual([
			{ label: 'July 2026', posts: [july] },
			{ label: 'August 2026', posts: [august] },
		])
	})
})
