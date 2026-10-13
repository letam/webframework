import type { PracticeSnapshot } from '@/lib/api/practice'

export interface ClockAnchor {
	serverMs: number
	monoMs: number
	rttMs: number
	sampledAt: number
}

export function clockSample(
	serverTime: string,
	sentMono: number,
	receivedMono: number
): ClockAnchor | null {
	const serverMs = Date.parse(serverTime)
	if (!Number.isFinite(serverMs) || receivedMono < sentMono) return null
	const rttMs = receivedMono - sentMono
	return { serverMs: serverMs + rttMs / 2, monoMs: receivedMono, rttMs, sampledAt: receivedMono }
}

export function shouldUseClockSample(current: ClockAnchor | null, next: ClockAnchor) {
	return !current || next.rttMs <= current.rttMs || next.sampledAt - current.sampledAt >= 60_000
}

export function practiceRemainingMs(
	snapshot: PracticeSnapshot,
	clock: ClockAnchor | null,
	nowMono: number
) {
	if (snapshot.status !== 'running' || !snapshot.deadline) return Math.max(0, snapshot.remaining_ms)
	if (!clock) return Math.max(0, snapshot.remaining_ms)
	const deadlineMs = Date.parse(snapshot.deadline)
	if (!Number.isFinite(deadlineMs)) return Math.max(0, snapshot.remaining_ms)
	return Math.max(0, deadlineMs - (clock.serverMs + nowMono - clock.monoMs))
}

export function formatRemaining(ms: number) {
	const totalSeconds = Math.ceil(Math.max(0, ms) / 1000)
	const seconds = totalSeconds % 60
	const minutes = Math.floor(totalSeconds / 60)
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
