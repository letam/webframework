import { describe, expect, it } from 'vitest'
import type { PracticeSnapshot } from '@/lib/api/practice'
import {
	clockSample,
	formatRemaining,
	practiceRemainingMs,
	shouldUseClockSample,
} from '@/lib/practice/clock'
import { initialPracticeRoomState, practiceRoomReducer } from '@/lib/practice/state'

function snapshot(
	revision: number,
	presenceSequence = 0,
	membershipRevision = 0
): PracticeSnapshot {
	return {
		v: 1,
		type: 'room.snapshot',
		room_id: 'room',
		title: 'Together',
		host_id: 1,
		closed_at: null,
		duration_ms: 600_000,
		run_id: 1,
		status: 'running',
		remaining_ms: 600_000,
		deadline: '2026-10-13T12:10:00.000Z',
		revision,
		server_time: '2026-10-13T12:00:00.000Z',
		members: [{ user_id: 1, username: 'host', is_host: true, connected: true }],
		membership_revision: membershipRevision,
		presence_sequence: presenceSequence,
		heartbeat_seconds: 20,
		lease_seconds: 60,
	}
}

describe('practice clock', () => {
	it('projects a common deadline without reading device wall time', () => {
		const sample = clockSample('2026-10-13T12:00:00.000Z', 100, 200)
		// Wall clock may be five minutes ahead or behind; only server time and monotonic time matter.
		if (!sample) throw new Error('Expected a clock sample')
		expect(practiceRemainingMs(snapshot(1), sample, 250)).toBe(599_900)
		expect(practiceRemainingMs(snapshot(1), sample, 1_250)).toBe(598_900)
		expect(formatRemaining(0)).toBe('00:00')
	})

	it('prefers low-latency samples and rejects delayed samples until an anchor ages', () => {
		const fast = clockSample('2026-10-13T12:00:00Z', 100, 120)
		const slow = clockSample('2026-10-13T12:00:01Z', 900, 1200)
		if (!fast || !slow) throw new Error('Expected clock samples')
		expect(shouldUseClockSample(fast, slow)).toBe(false)
		expect(shouldUseClockSample(fast, { ...slow, sampledAt: 60_121 })).toBe(true)
	})
})

describe('practice revision and presence reconciliation', () => {
	it('keeps timer, membership, and presence versions independent', () => {
		let state = practiceRoomReducer(initialPracticeRoomState, {
			type: 'snapshot',
			snapshot: snapshot(2, 3, 1),
		})
		state = practiceRoomReducer(state, { type: 'snapshot', snapshot: snapshot(1, 2, 1) })
		expect(state.snapshot?.revision).toBe(2)
		expect(state.presenceSequence).toBe(3)
		const away = snapshot(2, 4, 1).members
		away[0].connected = false
		state = practiceRoomReducer(state, {
			type: 'presence',
			sequence: 4,
			membershipRevision: 1,
			members: away,
		})
		state = practiceRoomReducer(state, {
			type: 'presence',
			sequence: 3,
			membershipRevision: 1,
			members: snapshot(2).members,
		})
		expect(state.members[0].connected).toBe(false)
		state = practiceRoomReducer(state, { type: 'snapshot', snapshot: snapshot(5, 2, 1) })
		expect(state.needsSync).toBe(true)
		expect(state.presenceSequence).toBe(4)
		state = practiceRoomReducer(state, {
			type: 'snapshot',
			snapshot: snapshot(5, 1, 1),
			newConnection: true,
		})
		expect(state.presenceSequence).toBe(1)
	})

	it('never resurrects a revoked member from delayed snapshot or presence events', () => {
		const initial = snapshot(2, 7, 2)
		initial.members.push({ user_id: 2, username: 'guest', is_host: false, connected: true })
		let state = practiceRoomReducer(initialPracticeRoomState, {
			type: 'snapshot',
			snapshot: initial,
		})
		const afterRevoke = snapshot(2, 7, 3)
		afterRevoke.members[0].connected = false // HTTP has no Redis liveness.
		state = practiceRoomReducer(state, { type: 'snapshot', snapshot: afterRevoke })
		expect(state.members).toEqual([
			{ user_id: 1, username: 'host', is_host: true, connected: true },
		])
		const delayed = snapshot(3, 6, 2)
		delayed.members.push({ user_id: 2, username: 'guest', is_host: false, connected: true })
		state = practiceRoomReducer(state, { type: 'snapshot', snapshot: delayed })
		expect(state.snapshot?.revision).toBe(3)
		expect(state.members.map((member) => member.user_id)).toEqual([1])
		delayed.members[0].connected = false
		state = practiceRoomReducer(state, {
			type: 'presence',
			sequence: 8,
			membershipRevision: 2,
			members: delayed.members,
		})
		expect(state.members).toEqual([
			{ user_id: 1, username: 'host', is_host: true, connected: false },
		])
		const newMember = snapshot(1, 7, 4) // Older timer data, newer authorized membership.
		newMember.members.push({ user_id: 3, username: 'new', is_host: false, connected: false })
		state = practiceRoomReducer(state, { type: 'snapshot', snapshot: newMember })
		expect(state.snapshot?.revision).toBe(3)
		expect(state.members.map((member) => member.user_id)).toEqual([1, 3])
		expect(state.membershipRevision).toBe(4)
	})
})
