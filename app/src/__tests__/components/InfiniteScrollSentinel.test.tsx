import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InfiniteScrollSentinel } from '@/components/feed/InfiniteScrollSentinel'

describe('InfiniteScrollSentinel', () => {
	it('calls onLoadMore when the sentinel intersects', () => {
		const onLoadMore = vi.fn()
		render(<InfiniteScrollSentinel onLoadMore={onLoadMore} hasMore={true} loading={false} />)

		__triggerIntersect()

		expect(onLoadMore).toHaveBeenCalledTimes(1)
	})

	it('does not trigger while a page is already loading', () => {
		const onLoadMore = vi.fn()
		render(<InfiniteScrollSentinel onLoadMore={onLoadMore} hasMore={true} loading={true} />)

		__triggerIntersect()

		expect(onLoadMore).not.toHaveBeenCalled()
	})

	it('renders nothing when there are no more pages', () => {
		const { container } = render(
			<InfiniteScrollSentinel onLoadMore={vi.fn()} hasMore={false} loading={false} />
		)

		expect(container).toBeEmptyDOMElement()
	})
})
