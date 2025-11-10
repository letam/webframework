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
 * When the user pulls down from the top of the page past the threshold
 * we trigger a hard refresh (full page reload) unless a custom handler is provided.
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
		if (typeof window === 'undefined') {
			return
		}

		const setDistance = (distance: number) => {
			pullDistanceRef.current = distance
			setPullDistance(distance)
		}

		const handleTouchStart = (event: TouchEvent) => {
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

			if (pullDistanceRef.current >= threshold) {
				if (onRefresh) {
					onRefresh()
				} else {
					window.location.reload()
				}
			} else {
				setDistance(0)
			}

			startYRef.current = null
			isDraggingRef.current = false
			setIsDragging(false)
		}

		const options: AddEventListenerOptions = { passive: true }
		const moveOptions: AddEventListenerOptions = { passive: false }

		window.addEventListener('touchstart', handleTouchStart, options)
		window.addEventListener('touchmove', handleTouchMove, moveOptions)
		window.addEventListener('touchend', finishGesture, options)
		window.addEventListener('touchcancel', finishGesture, options)

		return () => {
			window.removeEventListener('touchstart', handleTouchStart, options)
			window.removeEventListener('touchmove', handleTouchMove, moveOptions)
			window.removeEventListener('touchend', finishGesture, options)
			window.removeEventListener('touchcancel', finishGesture, options)
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
			contentEl.style.setProperty('--ptr-content-translate', `${pullDistance}px`)
			contentEl.classList.toggle('ptr-content--dragging', isDragging)
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
