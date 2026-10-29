import { SERVER_API_URL } from '@/lib/constants'
import { csrfFetch, getFetchOptions } from '@/lib/utils/fetch'

export type PracticeStatus = 'ready' | 'running' | 'paused' | 'completed'
export type PracticeAction = 'start' | 'pause' | 'resume' | 'reset' | 'close'

export interface PracticeMember {
	user_id: number
	username: string
	is_host: boolean
	connected: boolean
}

export interface PracticeSnapshot {
	v: 1
	type: 'room.snapshot'
	room_id: string
	title: string
	host_id: number
	current_user_id?: number
	is_host?: boolean
	closed_at: string | null
	duration_ms: number
	run_id: number
	status: PracticeStatus
	remaining_ms: number
	deadline: string | null
	revision: number
	server_time: string
	members: PracticeMember[]
	membership_revision: number
	presence_sequence: number
	heartbeat_seconds: number
	lease_seconds: number
	sync_id?: string
}

export interface PracticeError extends Error {
	code?: string
	status?: number
}

const base = `${SERVER_API_URL}/practice/rooms/`

async function request<T>(
	path: string,
	method: 'GET' | 'POST',
	body?: Record<string, unknown>,
	signal?: AbortSignal
) {
	const response = await csrfFetch(`${base}${path}`, {
		...(await getFetchOptions(method, body)),
		signal,
	})
	if (!response.ok) {
		let data: { code?: string; message?: string } = {}
		try {
			data = await response.json()
		} catch {
			// An HTML proxy error is still displayed safely.
		}
		const error: PracticeError = new Error(data.message || `Request failed (${response.status}).`)
		error.code = data.code
		error.status = response.status
		throw error
	}
	return (await response.json()) as T
}

export const getPracticeRoom = (id: string, signal?: AbortSignal) =>
	request<PracticeSnapshot>(`${id}/`, 'GET', undefined, signal)
export const createPracticeRoom = (title: string, duration: number) =>
	request<{ snapshot: PracticeSnapshot; invitation_secret: string }>('', 'POST', {
		title,
		duration_minutes: duration,
	})
export const joinPracticeRoom = (id: string, secret: string) =>
	request<PracticeSnapshot>(`${id}/join/`, 'POST', { invitation_secret: secret })
export const leavePracticeRoom = (id: string) => request<{ left: true }>(`${id}/leave/`, 'POST', {})
export const rotatePracticeInvitation = (id: string) =>
	request<{ snapshot: PracticeSnapshot; invitation_secret: string }>(
		`${id}/invite/rotate/`,
		'POST',
		{}
	)
export const revokePracticeInvitation = (id: string) =>
	request<PracticeSnapshot>(`${id}/invite/revoke/`, 'POST', {})
export const revokePracticeMember = (id: string, userId: number) =>
	request<PracticeSnapshot>(`${id}/members/${userId}/revoke/`, 'POST', {})
