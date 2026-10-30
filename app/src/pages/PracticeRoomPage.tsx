import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import Navbar from '@/components/Navbar'
import { LoginModal } from '@/components/LoginModal'
import { SignupModal } from '@/components/SignupModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { usePracticeRoom } from '@/hooks/usePracticeRoom'
import {
	getPracticeRoom,
	joinPracticeRoom,
	leavePracticeRoom,
	revokePracticeInvitation,
	revokePracticeMember,
	rotatePracticeInvitation,
	type PracticeAction,
} from '@/lib/api/practice'
import { formatRemaining, practiceRemainingMs } from '@/lib/practice/clock'
import {
	captureInvitation,
	forgetHostInvitation,
	forgetInvitation,
	hostInvitation,
	practiceInvitationUrl,
	rememberHostInvitation,
} from '@/lib/practice/invitation'

export default function PracticeRoomRoute() {
	const { id = '' } = useParams()
	const { userId } = useAuth()
	return <PracticeRoomPage key={`${id}:${userId}`} />
}

function PracticeRoomPage() {
	const { id = '' } = useParams()
	const { isAuthenticated, isAuthLoading, userId } = useAuth()
	const [invite, setInvite] = useState(() => captureInvitation(id))
	useEffect(() => {
		const onHashChange = () => setInvite(captureInvitation(id))
		window.addEventListener('hashchange', onHashChange)
		return () => window.removeEventListener('hashchange', onHashChange)
	}, [id])
	const [hostSecret, setHostSecret] = useState<string | null>(() => hostInvitation(id))
	const [access, setAccess] = useState(false)
	const [loadState, setLoadState] = useState<
		'loading' | 'join' | 'unavailable' | 'error' | 'ready'
	>('loading')
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const [resetDuration, setResetDuration] = useState('')
	const [nowMono, setNowMono] = useState(() => performance.now())
	const room = usePracticeRoom(id, isAuthenticated && access)
	const { applySnapshot } = room

	useEffect(() => {
		if (!isAuthenticated) return
		let active = true
		setLoadState('loading')
		const sent = performance.now()
		void getPracticeRoom(id)
			.then((snapshot) => {
				if (active) {
					applySnapshot(snapshot, sent)
					setAccess(true)
					setLoadState('ready')
				}
			})
			.catch((cause: { status?: number; message?: string }) => {
				if (!active) return
				setAccess(false)
				if (cause.status === 403 || cause.status === 401) setLoadState('join')
				else if (cause.status === 404) setLoadState('unavailable')
				else {
					setLoadState('error')
					setError(cause.message || 'Could not load the room.')
				}
			})
		return () => {
			active = false
		}
	}, [isAuthenticated, id, applySnapshot])

	useEffect(() => {
		const timer = window.setInterval(() => setNowMono(performance.now()), 100)
		return () => clearInterval(timer)
	}, [])

	const mutate = async (action: () => Promise<unknown>, onSuccess?: () => void) => {
		setBusy(true)
		setError('')
		try {
			await action()
			onSuccess?.()
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'The request failed.')
		} finally {
			setBusy(false)
		}
	}

	const join = () => {
		if (!invite) return
		void mutate(async () => {
			const snapshot = await joinPracticeRoom(id, invite)
			applySnapshot(snapshot)
			forgetInvitation(id)
			setInvite(null)
			setAccess(true)
			setLoadState('ready')
		})
	}

	const sendCommand = (action: PracticeAction, minutes?: number) => {
		if (action === 'close' && !window.confirm('Close this practice room for everyone?')) return
		if (!room.command(action, minutes))
			setError('Wait for the room to reconnect before trying again.')
	}

	const snapshot = room.state.snapshot
	const isHost = snapshot ? (snapshot.is_host ?? snapshot.host_id === userId) : false
	const current = snapshot ? practiceRemainingMs(snapshot, room.clock, nowMono) : 0
	const displayedStatus =
		snapshot?.status === 'running' && current === 0 ? 'completed' : snapshot?.status
	const controlsReady =
		room.connection === 'connected' && !room.pendingAction && !busy && !snapshot?.closed_at
	const invitationLink = hostSecret && snapshot ? practiceInvitationUrl(id, hostSecret) : null

	return (
		<div className="min-h-screen bg-background text-foreground">
			<Navbar />
			<main className="mx-auto max-w-3xl px-4 py-10">
				<Link to="/practice" className="text-sm text-muted-foreground underline underline-offset-4">
					Practice rooms
				</Link>
				{isAuthLoading ? (
					<p className="mt-8">Checking your sign-in…</p>
				) : !isAuthenticated ? (
					<section className="mt-8 rounded-lg border p-6">
						<h1 className="text-2xl font-semibold">Sign in to join this room</h1>
						<p className="mt-2 text-muted-foreground">
							Your invitation will be ready after you sign in.
						</p>
						<div className="mt-4 flex gap-2">
							<LoginModal />
							<SignupModal />
						</div>
					</section>
				) : loadState === 'loading' ? (
					<p className="mt-8">Loading room…</p>
				) : loadState === 'unavailable' ? (
					<section className="mt-8">
						<h1 className="text-2xl font-semibold">Practice is unavailable</h1>
						<p className="mt-2 text-muted-foreground">
							This room or the practice service is not available here.
						</p>
					</section>
				) : loadState === 'error' ? (
					<section className="mt-8">
						<p role="alert">{error}</p>
						<Button
							className="mt-4"
							onClick={() =>
								void getPracticeRoom(id)
									.then((snapshot) => {
										applySnapshot(snapshot)
										setAccess(true)
										setLoadState('ready')
									})
									.catch((cause) => setError(cause.message))
							}
						>
							Try again
						</Button>
					</section>
				) : loadState === 'join' ? (
					<section className="mt-8 rounded-lg border p-6">
						<h1 className="text-2xl font-semibold">Join practice room</h1>
						<p className="mt-2 text-muted-foreground">
							Joining lets the host and participants see your username.
						</p>
						{invite ? (
							<Button className="mt-5" disabled={busy} onClick={join}>
								{busy ? 'Joining…' : 'Join room'}
							</Button>
						) : (
							<p className="mt-5 text-muted-foreground">
								You need a valid invitation link to join.
							</p>
						)}
						{error && (
							<p role="alert" className="mt-4 text-destructive">
								{error}
							</p>
						)}
					</section>
				) : snapshot ? (
					<>
						<header className="mt-8">
							<h1 className="text-3xl font-semibold tracking-tight">{snapshot.title}</h1>
							<p className="mt-2 text-sm text-muted-foreground">
								{isHost ? 'You are the host' : 'You are a participant'}
							</p>
						</header>
						<section
							aria-label="Shared timer"
							className="mt-8 rounded-xl border bg-card p-8 text-center"
						>
							<p className="text-sm font-medium capitalize text-muted-foreground">
								{snapshot.closed_at ? 'Room closed' : displayedStatus}
							</p>
							<p
								className="mt-3 font-mono text-6xl font-semibold tabular-nums sm:text-7xl"
								role="timer"
								aria-live="off"
								data-remaining-ms={Math.round(current)}
							>
								{formatRemaining(current)}
							</p>
							<output className="mt-4 block text-sm text-muted-foreground">
								{snapshot.closed_at
									? 'Room closed'
									: room.connection === 'connected'
										? 'Connected · timer confirmed'
										: room.connection === 'denied'
											? 'Room access ended'
											: room.connection === 'connecting'
												? 'Synchronizing timer…'
												: 'Connection lost · timer unconfirmed'}
							</output>
							{room.pendingAction && (
								<output className="mt-2 block text-sm">
									Waiting to confirm {room.pendingAction}…
								</output>
							)}
						</section>
						{isHost && !snapshot.closed_at && (
							<section aria-label="Host controls" className="mt-8 space-y-4 rounded-lg border p-6">
								<h2 className="text-xl font-semibold">Host controls</h2>
								<div className="flex flex-wrap gap-2">
									{displayedStatus === 'ready' && (
										<Button disabled={!controlsReady} onClick={() => sendCommand('start')}>
											Start
										</Button>
									)}
									{displayedStatus === 'running' && (
										<Button disabled={!controlsReady} onClick={() => sendCommand('pause')}>
											Pause
										</Button>
									)}
									{displayedStatus === 'paused' && (
										<Button disabled={!controlsReady} onClick={() => sendCommand('resume')}>
											Resume
										</Button>
									)}
								</div>
								<div className="flex flex-wrap items-end gap-2">
									<div>
										<label htmlFor="reset-duration" className="mb-2 block text-sm">
											New duration on reset (minutes)
										</label>
										<Input
											id="reset-duration"
											type="number"
											min={1}
											max={120}
											step={1}
											inputMode="numeric"
											placeholder={String(snapshot.duration_ms / 60000)}
											value={resetDuration}
											onChange={(event) => setResetDuration(event.target.value)}
											className="w-48"
										/>
									</div>
									<Button
										variant="outline"
										disabled={!controlsReady}
										onClick={() => {
											const duration = resetDuration === '' ? undefined : Number(resetDuration)
											if (
												duration !== undefined &&
												(!Number.isInteger(duration) || duration < 1 || duration > 120)
											) {
												setError('Choose a whole number of minutes from 1 to 120.')
												return
											}
											sendCommand('reset', duration)
										}}
									>
										Reset timer
									</Button>
								</div>
								<Button
									variant="destructive"
									disabled={!controlsReady}
									onClick={() => sendCommand('close')}
								>
									Close room
								</Button>
							</section>
						)}
						{isHost && !snapshot.closed_at && (
							<section aria-label="Invitation" className="mt-8 space-y-3 rounded-lg border p-6">
								<h2 className="text-xl font-semibold">Invitation</h2>
								{invitationLink ? (
									<>
										<p className="text-sm text-muted-foreground">
											Only people with this link can ask to join.
										</p>
										<div className="flex flex-wrap gap-2">
											<Input
												aria-label="Invitation link"
												readOnly
												value={invitationLink}
												className="min-w-0 flex-1"
											/>
											<Button
												variant="outline"
												onClick={() =>
													void navigator.clipboard
														.writeText(invitationLink)
														.catch(() =>
															setError('Could not copy the link. Select it and copy manually.')
														)
												}
											>
												Copy link
											</Button>
										</div>
									</>
								) : (
									<p className="text-sm text-muted-foreground">
										Create a new link to invite someone.
									</p>
								)}
								<div className="flex flex-wrap gap-2">
									<Button
										variant="outline"
										disabled={busy || room.connection !== 'connected'}
										onClick={() =>
											void mutate(async () => {
												const result = await rotatePracticeInvitation(id)
												applySnapshot(result.snapshot)
												rememberHostInvitation(id, result.invitation_secret)
												setHostSecret(result.invitation_secret)
											})
										}
									>
										Rotate invitation
									</Button>
									<Button
										variant="outline"
										disabled={busy || room.connection !== 'connected'}
										onClick={() =>
											void mutate(async () => {
												const result = await revokePracticeInvitation(id)
												applySnapshot(result)
												forgetHostInvitation(id)
												setHostSecret(null)
											})
										}
									>
										Revoke invitation
									</Button>
								</div>
							</section>
						)}
						<section aria-label="Participants" className="mt-8 rounded-lg border p-6">
							<h2 className="text-xl font-semibold">Participants</h2>
							<ul className="mt-4 space-y-2">
								{room.state.members.map((member) => (
									<li key={member.user_id} className="flex items-center justify-between gap-3">
										<span>
											{member.username} {member.is_host ? '(host)' : ''}{' '}
											<span className="text-sm text-muted-foreground">
												· {member.connected ? 'connected' : 'away'}
											</span>
										</span>
										{isHost && member.user_id !== userId && !snapshot.closed_at && (
											<Button
												variant="ghost"
												size="sm"
												disabled={busy || room.connection !== 'connected'}
												onClick={() => {
													if (window.confirm(`Remove ${member.username} from this room?`))
														void mutate(async () => {
															const result = await revokePracticeMember(id, member.user_id)
															applySnapshot(result)
														})
												}}
											>
												Remove
											</Button>
										)}
									</li>
								))}
							</ul>
							{!isHost && !snapshot.closed_at && (
								<Button
									className="mt-5"
									variant="outline"
									disabled={busy}
									onClick={() =>
										void mutate(
											() => leavePracticeRoom(id),
											() => {
												setAccess(false)
												setLoadState('join')
												forgetInvitation(id)
												setInvite(null)
											}
										)
									}
								>
									Leave room
								</Button>
							)}
						</section>
						{error && (
							<p role="alert" className="mt-5 text-destructive">
								{error}
							</p>
						)}
						{room.message &&
							(room.messageIsError ? (
								<p role="alert" className="mt-5 text-destructive">
									{room.message}
								</p>
							) : (
								<output className="mt-5 block text-sm">{room.message}</output>
							))}
					</>
				) : (
					<p className="mt-8">Loading room…</p>
				)}
			</main>
		</div>
	)
}
