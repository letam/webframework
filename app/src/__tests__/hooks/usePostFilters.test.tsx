import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeAuthor, makePost } from '@/__tests__/data/mockPosts'
import { usePostFilters } from '@/hooks/usePostFilters'

const posts = [
	makePost({
		id: 1,
		author: makeAuthor({ username: 'maya' }),
		head: 'Deep work notes',
		body: 'A focused update with #writing',
	}),
	makePost({
		id: 2,
		author: makeAuthor({ username: 'maya' }),
		head: 'Draft',
		body: 'A focused private update with #draft',
	}),
	makePost({
		id: 3,
		author: makeAuthor({ username: 'noah' }),
		head: 'Garden',
		body: 'A field note with #writing',
	}),
]

describe('usePostFilters', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	it('filters posts with mixed operators', () => {
		const { result } = renderHook(() => usePostFilters(posts))

		act(() => {
			result.current.addFiltersFromText('author:MAYA focused -#draft')
		})

		expect(result.current.filteredPosts.map((post) => post.id)).toEqual([1])
	})

	it('keeps negative tags out of popover tag sync', () => {
		const { result } = renderHook(() => usePostFilters(posts))

		act(() => {
			result.current.addFiltersFromText('#writing -#draft')
		})

		expect(result.current.tagFilters.map((filter) => filter.token)).toEqual(['#writing'])

		act(() => {
			result.current.applyTagFilters(['#garden'])
		})

		expect(result.current.filters.map((filter) => filter.token)).toEqual(['-#draft', '#garden'])
		expect(result.current.tagFilters.map((filter) => filter.token)).toEqual(['#garden'])
	})

	it('applies saved snapshots by replacing current filters with enabled filters', () => {
		const { result } = renderHook(() => usePostFilters(posts))

		act(() => {
			result.current.addFiltersFromText('focused')
		})

		act(() => {
			result.current.applyFilterSet({ tokens: ['author:noah', '#writing'], matchMode: 'and' })
		})

		expect(result.current.filters).toEqual([
			{ token: 'author:noah', enabled: true },
			{ token: '#writing', enabled: true },
		])
		expect(result.current.matchMode).toBe('and')
		expect(result.current.filteredPosts.map((post) => post.id)).toEqual([3])
	})
})
