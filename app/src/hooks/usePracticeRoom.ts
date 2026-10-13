import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { PracticeAction, PracticeSnapshot } from '@/lib/api/practice'
import { getPracticeRoom } from '@/lib/api/practice'
import { SERVER_HOST } from '@/lib/constants'
import { clockSample, shouldUseClockSample, type ClockAnchor } from '@/lib/practice/clock'
import {
	initialPracticeRoomState,
	practiceRoomReducer,
	type PracticeRoomEvent,
} from '@/lib/practice/state'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'denied'

const COMMAND_ERRORS: Record<string, string> = {
	revision_conflict: 'The room changed. Refresh and try again.',
	invalid_transition: 'That action is unavailable in the current timer state.',
	host_only: 'Only the host can control this timer.',
	closed: 'This room is closed.',
	request_id_reused: 'This change could not be retried. Refresh the room.',
	invalid_request: 'That request was invalid. Refresh and try again.',
}

type PendingCommand = {
	v: 1
	type: 'timer.command'
	request_id: string
	expected_revision: number
	action: PracticeAction
	duration_minutes?: number
}

function socketUrl(roomId: string) {
	const url = new URL(`${SERVER_HOST}/ws/practice/rooms/${roomId}/`, window.location.href)
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
	return url.toString()
}

export function usePracticeRoom(roomId: string, enabled: boolean) {
	const [state, reactDispatch] = useReducer(practiceRoomReducer, initialPracticeRoomState)
	const stateRef = useRef(state)
	const dispatch = useCallback((event: PracticeRoomEvent) => {
		stateRef.current = practiceRoomReducer(stateRef.current, event)
		reactDispatch(event)
	}, [])
	const [connection, setConnection] = useState<ConnectionStatus>('connecting')
	const [clock, setClock] = useState<ClockAnchor | null>(null)
	const clockRef = useRef<ClockAnchor | null>(null)
	const [pendingAction, setPendingAction] = useState<PracticeAction | null>(null)
	const pendingRef = useRef<PendingCommand | null>(null)
	const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const armAckTimeout = useCallback((socket: WebSocket, requestId: string) => {
		if (ackTimerRef.current) clearTimeout(ackTimerRef.current)
		ackTimerRef.current = setTimeout(() => {
			if (pendingRef.current?.request_id === requestId && socketRef.current === socket) {
				setConnection('disconnected')
				socket.close()
			}
		}, 10_000)
	}, [])
	const [message, setMessage] = useState('')
	const [messageIsError, setMessageIsError] = useState(false)
	const confirmedRef = useRef(false)
	const socketRef = useRef<WebSocket | null>(null)
	const requestSnapshotRef = useRef<() => void>(() => undefined)

	const applySnapshot = useCallback(
		(snapshot: PracticeSnapshot, sentMono?: number, receivedMono = performance.now()) => {
			const before = stateRef.current.snapshot
			if (sentMono !== undefined && (!before || snapshot.revision >= before.revision)) {
				const sample = clockSample(snapshot.server_time, sentMono, receivedMono)
				if (sample && shouldUseClockSample(clockRef.current, sample)) {
					clockRef.current = sample
					setClock(sample)
				}
			}
			dispatch({ type: 'snapshot', snapshot })
			if (before && snapshot.revision > before.revision + 1) requestSnapshotRef.current()
		},
		[dispatch]
	)

	const refresh = useCallback(async () => {
		const sent = performance.now()
		const snapshot = await getPracticeRoom(roomId)
		applySnapshot(snapshot, sent)
		return snapshot
	}, [roomId, applySnapshot])

	const command = useCallback(
		(action: PracticeAction, durationMinutes?: number) => {
			const socket = socketRef.current
			const snapshot = stateRef.current.snapshot
			if (
				!snapshot ||
				socket?.readyState !== WebSocket.OPEN ||
				!confirmedRef.current ||
				pendingRef.current
			)
				return false
			const next: PendingCommand = {
				v: 1,
				type: 'timer.command',
				request_id: crypto.randomUUID(),
				expected_revision: snapshot.revision,
				action,
			}
			if (action === 'reset' && durationMinutes !== undefined)
				next.duration_minutes = durationMinutes
			pendingRef.current = next
			setPendingAction(action)
			setMessage('')
			setMessageIsError(false)
			try {
				socket.send(JSON.stringify(next))
				armAckTimeout(socket, next.request_id)
				return true
			} catch {
				// The request may have reached the server. Retry this same ID on reconnect.
				setConnection('disconnected')
				socket.close()
				return true
			}
		},
		[armAckTimeout]
	)

	useEffect(() => {
		if (!enabled || stateRef.current.snapshot?.closed_at) return
		let disposed = false
		let reconnectTimer: ReturnType<typeof setTimeout> | undefined
		let heartbeatTimer: ReturnType<typeof setTimeout> | undefined
		let staleTimer: ReturnType<typeof setInterval> | undefined
		let socket: WebSocket | null = null
		let attempt = 0
		let firstSnapshot = true
		let confirmed = false
		let forceSample = true
		let denied = false
		let probing = false
		let probeController: AbortController | null = null
		let lastReply = performance.now()
		let heartbeatSeconds = 20
		let leaseSeconds = 60
		const syncRequests = new Map<string, number>()

		const sendSync = (type: 'hello' | 'heartbeat' | 'snapshot') => {
			if (!socket || socket.readyState !== WebSocket.OPEN) return
			const syncId = crypto.randomUUID()
			syncRequests.set(syncId, performance.now())
			if (syncRequests.size > 8) syncRequests.delete(syncRequests.keys().next().value)
			socket.send(JSON.stringify({ v: 1, type, sync_id: syncId }))
		}
		requestSnapshotRef.current = () => sendSync('snapshot')
		const scheduleHeartbeat = () => {
			if (heartbeatTimer) clearTimeout(heartbeatTimer)
			heartbeatTimer = setTimeout(() => {
				sendSync('heartbeat')
				scheduleHeartbeat()
			}, heartbeatSeconds * 1000)
		}

		const markDenied = () => {
			denied = true
			confirmedRef.current = false
			setConnection('denied')
			if (pendingRef.current) {
				pendingRef.current = null
				if (ackTimerRef.current) clearTimeout(ackTimerRef.current)
				setPendingAction(null)
				setMessageIsError(true)
				setMessage('The last change could not be confirmed because room access ended.')
			}
		}

		const scheduleReconnect = () => {
			if (disposed || !navigator.onLine || denied) return
			const delay =
				Math.min(30_000, 1_000 * 2 ** Math.min(attempt++, 5)) * (0.5 + Math.random() / 2)
			reconnectTimer = setTimeout(connect, delay)
		}

		const connect = () => {
			if (disposed || denied || !navigator.onLine) return
			if (heartbeatTimer) clearTimeout(heartbeatTimer)
			if (staleTimer) clearInterval(staleTimer)
			if (reconnectTimer) clearTimeout(reconnectTimer)
			setConnection('connecting')
			firstSnapshot = true
			confirmed = false
			confirmedRef.current = false
			forceSample = true
			syncRequests.clear()
			try {
				socket = new WebSocket(socketUrl(roomId))
				socketRef.current = socket
			} catch {
				setConnection('disconnected')
				scheduleReconnect()
				return
			}
			const current = socket
			current.onopen = () => {
				if (disposed) return
				lastReply = performance.now()
				sendSync('hello')
				scheduleHeartbeat()
				staleTimer = setInterval(() => {
					if (performance.now() - lastReply > leaseSeconds * 1000) {
						setConnection('disconnected')
						current.close()
					}
				}, 1_000)
			}
			current.onmessage = (event) => {
				if (disposed || current !== socket) return
				let data: Record<string, unknown>
				try {
					data = JSON.parse(event.data)
				} catch {
					return
				}
				if (data.v !== 1) return
				lastReply = performance.now()
				attempt = 0
				if (data.type === 'room.snapshot') {
					const snapshot = data as unknown as PracticeSnapshot
					if (
						Number.isFinite(snapshot.heartbeat_seconds) &&
						snapshot.heartbeat_seconds > 0 &&
						snapshot.heartbeat_seconds !== heartbeatSeconds
					) {
						heartbeatSeconds = snapshot.heartbeat_seconds
						scheduleHeartbeat()
					}
					if (Number.isFinite(snapshot.lease_seconds) && snapshot.lease_seconds > 0)
						leaseSeconds = snapshot.lease_seconds
					const sent =
						typeof snapshot.sync_id === 'string' ? syncRequests.get(snapshot.sync_id) : undefined
					if (snapshot.sync_id) syncRequests.delete(snapshot.sync_id)
					// Broadcasts have no matching sync ID and must not pollute clock estimates.
					if (sent !== undefined) {
						const sample = clockSample(snapshot.server_time, sent, performance.now())
						if (sample && (forceSample || shouldUseClockSample(clockRef.current, sample))) {
							forceSample = false
							clockRef.current = sample
							setClock(sample)
						}
					}
					if (firstSnapshot) {
						dispatch({ type: 'snapshot', snapshot, newConnection: true })
						firstSnapshot = false
					} else applySnapshot(snapshot)
					if (sent !== undefined && !confirmed) {
						confirmed = true
						confirmedRef.current = true
						setConnection('connected')
						if (pendingRef.current) {
							current.send(JSON.stringify(pendingRef.current))
							armAckTimeout(current, pendingRef.current.request_id)
						}
					}
					return
				}
				if (data.type === 'room.presence') {
					dispatch({
						type: 'presence',
						sequence: data.sequence as number,
						membershipRevision: Number.isInteger(data.membership_revision)
							? (data.membership_revision as number)
							: 0,
						members: data.members as PracticeSnapshot['members'],
					})
					return
				}
				if (data.type === 'command.result') {
					const result = data as {
						request_id?: string
						accepted?: boolean
						code?: string
						snapshot?: PracticeSnapshot
					}
					if (result.snapshot) applySnapshot(result.snapshot)
					if (result.request_id === pendingRef.current?.request_id) {
						pendingRef.current = null
						if (ackTimerRef.current) clearTimeout(ackTimerRef.current)
						setPendingAction(null)
						setMessageIsError(!result.accepted)
						setMessage(
							result.accepted
								? 'Change confirmed.'
								: (result.code && COMMAND_ERRORS[result.code]) ||
										'The change was not accepted. Refresh and try again.'
						)
					}
					return
				}
				if (data.type === 'error') {
					setMessageIsError(true)
					setMessage(String(data.message || 'Room connection error.'))
				}
			}
			current.onclose = (event) => {
				if (current !== socket || disposed) return
				if (heartbeatTimer) clearTimeout(heartbeatTimer)
				if (staleTimer) clearInterval(staleTimer)
				socketRef.current = null
				confirmedRef.current = false
				if ([4401, 4403, 4404].includes(event.code)) {
					markDenied()
					return
				}
				setConnection('disconnected')
				if (event.code === 1006) {
					// Browsers report a rejected pre-accept handshake as 1006. Confirm
					// membership over HTTP before treating it as a transient outage.
					probing = true
					const controller = new AbortController()
					probeController = controller
					let timeout: ReturnType<typeof setTimeout>
					const deadline = new Promise<never>((_, reject) => {
						timeout = setTimeout(() => {
							controller.abort()
							reject(new Error('probe_timeout'))
						}, 10_000)
					})
					const sent = performance.now()
					void Promise.race([getPracticeRoom(roomId, controller.signal), deadline])
						.then((snapshot) => {
							if (disposed || current !== socket) return
							applySnapshot(snapshot, sent)
							if (snapshot.closed_at) markDenied()
							else scheduleReconnect()
						})
						.catch((error: { status?: number }) => {
							if (disposed || current !== socket) return
							if ([401, 403, 404].includes(error.status ?? 0)) markDenied()
							else scheduleReconnect()
						})
						.finally(() => {
							clearTimeout(timeout)
							if (current === socket) {
								probing = false
								probeController = null
							}
						})
					return
				}
				scheduleReconnect()
			}
		}

		const resync = () => {
			if (disposed || denied || probing) return
			forceSample = true
			confirmed = false
			confirmedRef.current = false
			syncRequests.clear()
			setConnection('connecting')
			if (navigator.onLine && socket?.readyState === WebSocket.OPEN) sendSync('snapshot')
			else if (navigator.onLine && !denied && socket?.readyState !== WebSocket.CONNECTING) connect()
		}
		const onVisibility = () => {
			if (document.visibilityState === 'visible') resync()
		}
		const onOffline = () => {
			confirmedRef.current = false
			setConnection('disconnected')
			socket?.close()
		}
		document.addEventListener('visibilitychange', onVisibility)
		window.addEventListener('pageshow', resync)
		window.addEventListener('online', resync)
		window.addEventListener('offline', onOffline)
		connect()
		return () => {
			disposed = true
			probeController?.abort()
			if (reconnectTimer) clearTimeout(reconnectTimer)
			if (heartbeatTimer) clearTimeout(heartbeatTimer)
			if (staleTimer) clearInterval(staleTimer)
			document.removeEventListener('visibilitychange', onVisibility)
			window.removeEventListener('pageshow', resync)
			window.removeEventListener('online', resync)
			window.removeEventListener('offline', onOffline)
			requestSnapshotRef.current = () => undefined
			socketRef.current = null
			pendingRef.current = null
			if (ackTimerRef.current) clearTimeout(ackTimerRef.current)
			clockRef.current = null
			confirmedRef.current = false
			socket?.close()
		}
	}, [roomId, enabled, applySnapshot, dispatch, armAckTimeout])

	return {
		state,
		connection,
		clock,
		pendingAction,
		message,
		messageIsError,
		applySnapshot,
		refresh,
		command,
	}
}
