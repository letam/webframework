import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import './PullToRefresh.css'

type PullToRefreshProps = {
	children: React.ReactNode
	onRefresh?: () => void
	threshold?: number
	maxPullDistance?: number
}

/**
 * Lightweight pull-to-refresh interaction for touch devices.
 *
 * When the user pulls down from the top of the page past the threshold we call
 * `onRefresh` — callers should pass one that refetches data (a soft refresh)
 * rather than relying on the `window.location.reload()` fallback, which discards
 * the SPA and its query cache. Touch listeners are scoped to the content element
 * and gestures that begin inside an overlay are ignored, so a drag inside a
 * dialog or popover can never be mistaken for a page pull.
 */
const PullToRefresh: React.FC<PullToRefreshProps> = ({
	children,
	onRefresh,
	threshold = 100,
	maxPullDistance = 160,
}) => {
	const startYRef = useRef<number | null>(null)
	const pullDistanceRef = useRef(0)
	const isDraggingRef = useRef(false)
	const [pullDistance, setPullDistance] = useState(0)
	const [isDragging, setIsDragging] = useState(false)
	const indicatorRef = useRef<HTMLDivElement | null>(null)
	const contentRef = useRef<HTMLDivElement | null>(null)
	const progressBarRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const contentEl = contentRef.current
		if (contentEl === null) {
			return
		}

		const setDistance = (distance: number) => {
			pullDistanceRef.current = distance
			setPullDistance(distance)
		}

		const handleTouchStart = (event: TouchEvent) => {
			// Ignore gestures that begin inside an overlay. Radix dialogs lock body
			// scroll at 0 and portal their content out of this subtree, so a drag
			// inside a record/preview/tag modal would otherwise satisfy `scrollY <= 0`
			// and be read as a page pull — releasing it reloaded the whole SPA.
			const target = event.target as Element | null
			if (target?.closest('[role="dialog"], [data-radix-popper-content-wrapper]')) {
				startYRef.current = null
				return
			}

			if (window.scrollY <= 0) {
				startYRef.current = event.touches[0]?.clientY ?? null
				isDraggingRef.current = false
			} else {
				startYRef.current = null
				setDistance(0)
			}
		}

		const handleTouchMove = (event: TouchEvent) => {
			if (startYRef.current === null) {
				return
			}

			const currentY = event.touches[0]?.clientY ?? 0
			const delta = currentY - startYRef.current

			if (delta <= 0) {
				setDistance(0)
				isDraggingRef.current = false
				setIsDragging(false)
				return
			}

			if (window.scrollY > 0) {
				startYRef.current = null
				setDistance(0)
				isDraggingRef.current = false
				setIsDragging(false)
				return
			}

			// Prevent native overscroll behavior so we can handle the gesture.
			event.preventDefault()

			const distance = Math.min(delta, maxPullDistance)
			isDraggingRef.current = true
			setIsDragging(true)
			setDistance(distance)
		}

		const finishGesture = () => {
			if (startYRef.current === null) {
				return
			}

			const shouldRefresh = pullDistanceRef.current >= threshold

			// Spring the content back first. With a custom `onRefresh` (a soft
			// query invalidation, no navigation) the old code left the content
			// pinned at the pull distance because it only reset on the else branch.
			startYRef.current = null
			isDraggingRef.current = false
			setIsDragging(false)
			setDistance(0)

			if (shouldRefresh) {
				if (onRefresh) {
					onRefresh()
				} else {
					window.location.reload()
				}
			}
		}

		const options: AddEventListenerOptions = { passive: true }
		const moveOptions: AddEventListenerOptions = { passive: false }

		// Scoped to the content element, not `window`: touches inside a portaled
		// Radix overlay never reach here, so an in-modal drag can't start a pull.
		contentEl.addEventListener('touchstart', handleTouchStart, options)
		contentEl.addEventListener('touchmove', handleTouchMove, moveOptions)
		contentEl.addEventListener('touchend', finishGesture, options)
		contentEl.addEventListener('touchcancel', finishGesture, options)

		return () => {
			contentEl.removeEventListener('touchstart', handleTouchStart, options)
			contentEl.removeEventListener('touchmove', handleTouchMove, moveOptions)
			contentEl.removeEventListener('touchend', finishGesture, options)
			contentEl.removeEventListener('touchcancel', finishGesture, options)
		}
	}, [maxPullDistance, onRefresh, threshold])

	const progress = Math.min(pullDistance / threshold, 1)
	const indicatorMessage = pullDistance >= threshold ? 'Release to refresh' : 'Pull to refresh'

	useEffect(() => {
		const indicatorEl = indicatorRef.current
		const contentEl = contentRef.current
		const progressEl = progressBarRef.current

		if (indicatorEl) {
			const opacity = pullDistance > 8 ? '1' : '0'
			const translateY = pullDistance > 8 ? `${Math.min(pullDistance / 4, 24)}px` : '-16px'

			indicatorEl.style.setProperty('--ptr-indicator-opacity', opacity)
			indicatorEl.style.setProperty('--ptr-indicator-translate', translateY)
		}

		if (contentEl) {
			contentEl.classList.toggle('ptr-content--dragging', isDragging)

			if (pullDistance > 0) {
				contentEl.style.setProperty('--ptr-content-translate', `${pullDistance}px`)
				contentEl.classList.add('ptr-content--translated')
			} else if (contentEl.classList.contains('ptr-content--translated')) {
				contentEl.style.setProperty('--ptr-content-translate', '0px')

				const handleTransitionEnd = () => {
					contentEl.classList.remove('ptr-content--translated')
					contentEl.style.removeProperty('--ptr-content-translate')
				}

				contentEl.addEventListener('transitionend', handleTransitionEnd, { once: true })
			} else {
				contentEl.style.removeProperty('--ptr-content-translate')
			}
		}

		if (progressEl) {
			const progressWidth = `${Math.max(progress * 100, 12)}%`
			progressEl.style.setProperty('--ptr-progress-width', progressWidth)
		}
	}, [isDragging, progress, pullDistance])

	return (
		<div className="ptr-container relative">
			<div
				ref={indicatorRef}
				className="ptr-indicator pointer-events-none fixed left-1/2 top-4 z-50 flex w-full max-w-xs justify-center"
			>
				<div className="flex items-center gap-2 rounded-full border bg-background/95 px-4 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
					<div className="h-2 w-12 overflow-hidden rounded-full bg-muted">
						<div ref={progressBarRef} className="ptr-progress-bar h-full rounded-full bg-primary" />
					</div>
					<span>{indicatorMessage}</span>
				</div>
			</div>

			<div ref={contentRef} className="ptr-content">
				{children}
			</div>
		</div>
	)
}

export default PullToRefresh
