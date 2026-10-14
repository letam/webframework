import { useState } from 'react'
import { useNavigate } from 'react-router'
import Navbar from '@/components/Navbar'
import { LoginModal } from '@/components/LoginModal'
import { SignupModal } from '@/components/SignupModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { createPracticeRoom } from '@/lib/api/practice'
import { rememberHostInvitation } from '@/lib/practice/invitation'

export default function PracticePage() {
	const { isAuthenticated, isAuthLoading } = useAuth()
	const navigate = useNavigate()
	const [title, setTitle] = useState('Practice room')
	const [duration, setDuration] = useState('10')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')

	const create = async (event: React.FormEvent) => {
		event.preventDefault()
		const minutes = Number(duration)
		if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
			setError('Choose a whole number of minutes from 1 to 120.')
			return
		}
		if (!title.trim()) {
			setError('Enter a room title.')
			return
		}
		setBusy(true)
		setError('')
		try {
			const result = await createPracticeRoom(title.trim(), minutes)
			rememberHostInvitation(result.snapshot.room_id, result.invitation_secret)
			navigate(`/practice/rooms/${result.snapshot.room_id}`)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Could not create the room.')
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="min-h-screen bg-background text-foreground">
			<Navbar />
			<main className="mx-auto max-w-2xl px-4 py-12">
				<h1 className="text-3xl font-semibold tracking-tight">Practice together</h1>
				<p className="mt-3 text-muted-foreground">
					Create an unlisted room, then invite people to share one timer.
				</p>
				{isAuthLoading ? (
					<p className="mt-8">Checking your sign-in…</p>
				) : !isAuthenticated ? (
					<div className="mt-8 rounded-lg border p-6">
						<p className="mb-4">Sign in to create a room.</p>
						<div className="flex gap-2">
							<LoginModal />
							<SignupModal />
						</div>
					</div>
				) : (
					<form onSubmit={create} className="mt-8 space-y-5 rounded-lg border p-6">
						<div>
							<label htmlFor="practice-title" className="block text-sm font-medium mb-2">
								Room title
							</label>
							<Input
								id="practice-title"
								value={title}
								maxLength={120}
								onChange={(event) => setTitle(event.target.value)}
								required
							/>
						</div>
						<div>
							<label htmlFor="practice-duration" className="block text-sm font-medium mb-2">
								Duration (minutes)
							</label>
							<Input
								id="practice-duration"
								type="number"
								inputMode="numeric"
								min={1}
								max={120}
								step={1}
								value={duration}
								onChange={(event) => setDuration(event.target.value)}
								required
							/>
						</div>
						{error && (
							<p role="alert" className="text-destructive">
								{error}
							</p>
						)}
						<Button disabled={busy} type="submit">
							{busy ? 'Creating…' : 'Create room'}
						</Button>
					</form>
				)}
			</main>
		</div>
	)
}
