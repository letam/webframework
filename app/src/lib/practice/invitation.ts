// Kept in this page's memory so the existing login dialog can update auth in place.
// Never store an invitation in a query string, referrer, socket URL or analytics.
const pendingInvitations = new Map<string, string>()
const hostInvitations = new Map<string, string>()

export function captureInvitation(roomId: string): string | null {
	const fragment = window.location.hash
	if (fragment.startsWith('#invite=')) {
		let secret = fragment.slice('#invite='.length)
		try {
			secret = decodeURIComponent(secret)
		} catch {
			secret = ''
		}
		// Remove the fragment before any room API or socket request starts.
		window.history.replaceState(
			window.history.state,
			'',
			window.location.pathname + window.location.search
		)
		if (secret) pendingInvitations.set(roomId, secret)
	}
	return pendingInvitations.get(roomId) ?? null
}

export function forgetInvitation(roomId: string) {
	pendingInvitations.delete(roomId)
}

export function practiceInvitationUrl(roomId: string, secret: string) {
	return `${window.location.origin}/practice/rooms/${encodeURIComponent(roomId)}#invite=${encodeURIComponent(secret)}`
}

export function rememberHostInvitation(roomId: string, secret: string) {
	hostInvitations.set(roomId, secret)
}

export function hostInvitation(roomId: string) {
	return hostInvitations.get(roomId) ?? null
}

export function forgetHostInvitation(roomId: string) {
	hostInvitations.delete(roomId)
}
