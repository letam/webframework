import { useCallback, useEffect, useRef, useState } from 'react'

export const useRecordingClock = (): {
	seconds: number
	start: () => void
	pause: () => void
	resume: () => void
	reset: () => void
} => {
	const [seconds, setSeconds] = useState(0)
	const startedAt = useRef<number | null>(null)
	const accumulatedMs = useRef(0)
	const interval = useRef<ReturnType<typeof setInterval> | null>(null)
	const tick = useCallback(() => {
		setSeconds(
			Math.floor(
				(accumulatedMs.current +
					(startedAt.current !== null ? Date.now() - startedAt.current : 0)) /
					1000
			)
		)
	}, [])
	const pause = useCallback(() => {
		if (startedAt.current !== null) accumulatedMs.current += Date.now() - startedAt.current
		startedAt.current = null
		if (interval.current !== null) clearInterval(interval.current)
		interval.current = null
		tick()
	}, [tick])
	const resume = useCallback(() => {
		if (startedAt.current !== null) return
		startedAt.current = Date.now()
		interval.current = setInterval(tick, 250)
	}, [tick])
	const reset = useCallback(() => {
		pause()
		accumulatedMs.current = 0
		setSeconds(0)
	}, [pause])
	const start = useCallback(() => {
		reset()
		resume()
	}, [reset, resume])
	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') tick()
		}
		document.addEventListener('visibilitychange', onVisibilityChange)
		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange)
			if (interval.current !== null) clearInterval(interval.current)
		}
	}, [tick])
	return { seconds, start, pause, resume, reset }
}
