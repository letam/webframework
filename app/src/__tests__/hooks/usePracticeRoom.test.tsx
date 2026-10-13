import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePracticeRoom } from '@/hooks/usePracticeRoom'
import type { PracticeSnapshot } from '@/lib/api/practice'

class RoomSocket {
	static OPEN = 1
	static instances: RoomSocket[] = []
	readyState = 0
	sent: Record<string, unknown>[] = []
	onopen: (() => void) | null = null
	onmessage: ((event: { data: string }) => void) | null = null
	onclose: ((event: { code: number }) => void) | null = null
	onerror: (() => void) | null = null
	constructor(public url: string) {
		RoomSocket.instances.push(this)
	}
	open() {
		this.readyState = 1
		this.onopen?.()
	}
	send(value: string) {
		this.sent.push(JSON.parse(value))
	}
	emit(value: object) {
		this.onmessage?.({ data: JSON.stringify(value) })
	}
	close(code = 1000) {
		if (this.readyState === 3) return
		this.readyState = 3
		this.onclose?.({ code })
	}
}

function snapshot(syncId?: string): PracticeSnapshot {
	return {
		v: 1,
		type: 'room.snapshot',
		room_id: 'room',
		title: 'Together',
		host_id: 1,
		current_user_id: 1,
		is_host: true,
		closed_at: null,
		duration_ms: 600_000,
		run_id: 1,
		status: 'ready',
		remaining_ms: 600_000,
		deadline: null,
		revision: 0,
		server_time: '2026-10-13T12:00:00Z',
		members: [],
		membership_revision: 0,
		presence_sequence: 0,
		heartbeat_seconds: 20,
		lease_seconds: 60,
		...(syncId ? { sync_id: syncId } : {}),
	}
}

beforeEach(() => {
	vi.useFakeTimers()
	RoomSocket.instances = []
	let id = 0
	vi.stubGlobal('WebSocket', RoomSocket)
	vi.stubGlobal('crypto', {
		randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
	})
	vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('usePracticeRoom lifecycle', () => {
	it('closes the first StrictMode socket and never reconnects after unmount', () => {
		const { unmount } = renderHook(() => usePracticeRoom('room', true), { wrapper: StrictMode })
		expect(RoomSocket.instances).toHaveLength(2)
		expect(RoomSocket.instances[0].readyState).toBe(3)
		const current = RoomSocket.instances[1]
		act(() => current.open())
		unmount()
		expect(current.readyState).toBe(3)
		act(() => vi.advanceTimersByTime(120_000))
		expect(RoomSocket.instances).toHaveLength(2)
	})

	it('does not open a socket for a closed HTTP snapshot', () => {
		const { result, rerender, unmount } = renderHook(
			({ enabled }) => usePracticeRoom('room', enabled),
			{ initialProps: { enabled: false } }
		)
		act(() => result.current.applySnapshot({ ...snapshot(), closed_at: '2026-10-13T12:00:00Z' }))
		rerender({ enabled: true })
		expect(RoomSocket.instances).toHaveLength(0)
		unmount()
	})

	it('stops after a 1006 handshake when HTTP says membership was revoked', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 403,
				json: async () => ({ code: 'forbidden', message: 'Room access ended.' }),
			})
		)
		const { result, unmount } = renderHook(() => usePracticeRoom('room', true))
		await act(async () => {
			RoomSocket.instances[0].close(1006)
			await Promise.resolve()
		})
		expect(result.current.connection).toBe('denied')
		act(() => vi.advanceTimersByTime(120_000))
		expect(RoomSocket.instances).toHaveLength(1)
		unmount()
	})

	it('bounds a stalled 1006 permission probe and returns to reconnect backoff', async () => {
		let aborted = false
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, options: RequestInit) =>
					new Promise((_resolve, reject) => {
						const signal = options.signal
						if (signal?.aborted) {
							aborted = true
							reject(new DOMException('Aborted', 'AbortError'))
						}
						signal?.addEventListener('abort', () => {
							aborted = true
							reject(new DOMException('Aborted', 'AbortError'))
						})
					})
			)
		)
		const { unmount } = renderHook(() => usePracticeRoom('room', true))
		await act(async () => {
			RoomSocket.instances[0].close(1006)
			await Promise.resolve()
		})
		await act(async () => {
			vi.advanceTimersByTime(10_001)
			await Promise.resolve()
		})
		expect(aborted).toBe(true)
		act(() => vi.advanceTimersByTime(30_000))
		expect(RoomSocket.instances).toHaveLength(2)
		unmount()
	})

	it('holds controls while a wake resync waits for a matched clock reply', () => {
		const { result, unmount } = renderHook(() => usePracticeRoom('room', true))
		const socket = RoomSocket.instances[0]
		act(() => socket.open())
		act(() => socket.emit(snapshot()))
		expect(result.current.command('start')).toBe(false)
		const hello = socket.sent.find((message) => message.type === 'hello')
		if (!hello) throw new Error('Missing hello')
		act(() => socket.emit(snapshot(hello.sync_id as string)))
		expect(result.current.connection).toBe('connected')
		act(() => vi.advanceTimersByTime(20_000))
		const oldHeartbeat = socket.sent.find((message) => message.type === 'heartbeat')
		if (!oldHeartbeat) throw new Error('Missing heartbeat')
		act(() => window.dispatchEvent(new Event('pageshow')))
		expect(result.current.connection).toBe('connecting')
		expect(result.current.command('start')).toBe(false)
		act(() => socket.emit(snapshot(oldHeartbeat.sync_id as string)))
		expect(result.current.connection).toBe('connecting')
		const resync = socket.sent.find((message) => message.type === 'snapshot')
		if (!resync) throw new Error('Missing wake resync')
		act(() => socket.emit(snapshot(resync.sync_id as string)))
		expect(result.current.connection).toBe('connected')
		expect(result.current.command('start')).toBe(true)
		unmount()
	})

	it('requires a matched hello before enabling controls and retries an unknown result with the same ID', () => {
		const { result, unmount } = renderHook(() => usePracticeRoom('room', true))
		const first = RoomSocket.instances[0]
		act(() => first.open())
		act(() => first.emit(snapshot()))
		expect(result.current.connection).toBe('connecting')
		const hello = first.sent.find((message) => message.type === 'hello')
		if (!hello) throw new Error('Missing hello')
		act(() => first.emit(snapshot(hello.sync_id as string)))
		expect(result.current.connection).toBe('connected')
		act(() => expect(result.current.command('start')).toBe(true))
		const command = first.sent.find((message) => message.type === 'timer.command')
		if (!command) throw new Error('Missing command')
		expect(result.current.pendingAction).toBe('start')
		act(() => vi.advanceTimersByTime(11_000))
		expect(first.readyState).toBe(3)
		expect(result.current.connection).not.toBe('connected')
		const second = RoomSocket.instances[1]
		act(() => second.open())
		const hello2 = second.sent.find((message) => message.type === 'hello')
		if (!hello2) throw new Error('Missing reconnect hello')
		act(() => second.emit(snapshot(hello2.sync_id as string)))
		const replay = second.sent.find((message) => message.type === 'timer.command')
		if (!replay) throw new Error('Missing retry')
		expect(replay).toEqual(command)
		act(() =>
			second.emit({
				v: 1,
				type: 'command.result',
				request_id: command.request_id,
				accepted: true,
				snapshot: snapshot(),
			})
		)
		expect(result.current.pendingAction).toBe(null)
		act(() => expect(result.current.command('pause')).toBe(true))
		const rejected = second.sent.filter((message) => message.type === 'timer.command').at(-1)
		if (!rejected) throw new Error('Missing rejected command')
		act(() =>
			second.emit({
				v: 1,
				type: 'command.result',
				request_id: rejected.request_id,
				accepted: false,
				code: 'revision_conflict',
				snapshot: snapshot(),
			})
		)
		expect(result.current.message).toBe('The room changed. Refresh and try again.')
		expect(result.current.messageIsError).toBe(true)
		unmount()
	})
})
