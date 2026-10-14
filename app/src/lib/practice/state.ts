import type { PracticeMember, PracticeSnapshot } from '@/lib/api/practice'

export interface PracticeRoomState {
	snapshot: PracticeSnapshot | null
	members: PracticeMember[]
	membershipRevision: number
	presenceSequence: number
	needsSync: boolean
}

export const initialPracticeRoomState: PracticeRoomState = {
	snapshot: null,
	members: [],
	membershipRevision: -1,
	presenceSequence: -1,
	needsSync: false,
}

export type PracticeRoomEvent =
	| { type: 'snapshot'; snapshot: PracticeSnapshot; newConnection?: boolean }
	| { type: 'presence'; sequence: number; membershipRevision: number; members: PracticeMember[] }
	| { type: 'synced' }
	| { type: 'reset' }

function reconcileMembers(
	state: PracticeRoomState,
	incoming: PracticeMember[],
	membershipRevision: number,
	usePresence: boolean
) {
	if (membershipRevision < state.membershipRevision) {
		// A delayed roster may still carry newer liveness, but cannot restore revoked IDs.
		return usePresence
			? state.members.map((member) => ({
					...member,
					connected:
						incoming.find((next) => next.user_id === member.user_id)?.connected ?? member.connected,
				}))
			: state.members
	}
	return incoming.map((member) => ({
		...member,
		connected: usePresence
			? member.connected
			: (state.members.find((prior) => prior.user_id === member.user_id)?.connected ??
				member.connected),
	}))
}

export function practiceRoomReducer(
	state: PracticeRoomState,
	event: PracticeRoomEvent
): PracticeRoomState {
	if (event.type === 'reset') return initialPracticeRoomState
	if (event.type === 'synced') return { ...state, needsSync: false }
	if (event.type === 'presence') {
		const usePresence = event.sequence > state.presenceSequence
		if (!usePresence && event.membershipRevision < state.membershipRevision) return state
		return {
			...state,
			members: reconcileMembers(state, event.members, event.membershipRevision, usePresence),
			membershipRevision: Math.max(state.membershipRevision, event.membershipRevision),
			presenceSequence: usePresence ? event.sequence : state.presenceSequence,
		}
	}
	const next = event.snapshot
	const membershipRevision = Number.isInteger(next.membership_revision)
		? next.membership_revision
		: 0
	const useTimer = !state.snapshot || next.revision >= state.snapshot.revision
	const usePresence = !!event.newConnection || next.presence_sequence > state.presenceSequence
	const gap = !!state.snapshot && next.revision > state.snapshot.revision + 1
	return {
		snapshot: useTimer ? next : state.snapshot,
		members: reconcileMembers(state, next.members, membershipRevision, usePresence),
		membershipRevision: Math.max(state.membershipRevision, membershipRevision),
		presenceSequence: usePresence ? next.presence_sequence : state.presenceSequence,
		needsSync: gap || state.needsSync,
	}
}
