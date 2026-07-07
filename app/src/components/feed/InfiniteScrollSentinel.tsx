import { useEffect, useRef } from 'react'

interface InfiniteScrollSentinelProps {
	onLoadMore: () => void
	hasMore: boolean
	loading: boolean
}

export const InfiniteScrollSentinel = ({
	onLoadMore,
	hasMore,
	loading,
}: InfiniteScrollSentinelProps) => {
	const sentinelRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const sentinel = sentinelRef.current

		if (!sentinel || !hasMore || loading) {
			return
		}

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting && hasMore && !loading) {
					onLoadMore()
				}
			},
			{ rootMargin: '400px' }
		)

		observer.observe(sentinel)
		return () => observer.disconnect()
	}, [hasMore, loading, onLoadMore])

	if (!hasMore && !loading) {
		return null
	}

	return (
		<div ref={sentinelRef} className="py-6 text-center text-sm text-muted-foreground">
			{loading ? 'Loading more…' : null}
		</div>
	)
}
