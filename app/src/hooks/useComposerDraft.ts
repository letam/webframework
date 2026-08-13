import { useCallback, useEffect, useRef, useState } from 'react'
import type { PostVisibility } from '@/types/post'
import {
	type ComposerDraft,
	type ComposerMediaType,
	clearComposerDraft,
	draftKeyForUser,
	loadComposerDraft,
	saveComposerDraft,
	updateComposerDraftFields,
} from '@/lib/utils/composerDraft'

/** Text edits settle before hitting disk; a keystroke is not worth a write. */
const TEXT_DEBOUNCE_MS = 600

interface UseComposerDraftOptions {
	/** Off when the user has disabled autosave in Settings. */
	enabled: boolean
	userId: number | null
	text: string
	visibility: PostVisibility
	mediaType: ComposerMediaType
	/** The single attachment in play, whichever slot holds it. */
	media: Blob | null
	/** True when there is nothing worth saving (no text, no media). */
	isEmpty: boolean
	/** Called with a restored draft; the composer maps it back onto its state. */
	onRestore: (draft: ComposerDraft) => void
}

/** A Blob carries no filename, so the two are stored side by side. */
const toRecord = (
	text: string,
	visibility: PostVisibility,
	mediaType: ComposerMediaType,
	media: Blob | null
) => ({
	text,
	visibility,
	mediaType,
	media,
	mediaName: media instanceof File ? media.name : null,
	mediaIsFile: media instanceof File,
})

/**
 * Keep the composer's contents on disk, and hand them back after a reload.
 *
 * Restoring is deliberately conservative: once per storage key, and only into an
 * empty composer. Someone who started typing while `/auth/status/` was still in
 * flight must never have their words replaced by an older draft.
 */
export const useComposerDraft = ({
	enabled,
	userId,
	text,
	visibility,
	mediaType,
	media,
	isEmpty,
	onRestore,
}: UseComposerDraftOptions) => {
	const [restored, setRestored] = useState<ComposerDraft | null>(null)

	// Read live values from callbacks that must not re-subscribe on every
	// keystroke.
	const latest = useRef({ text, visibility, mediaType, media, isEmpty, onRestore })
	latest.current = { text, visibility, mediaType, media, isEmpty, onRestore }

	const storageKey = draftKeyForUser(userId)
	const restoredKeys = useRef(new Set<string>())

	// Restore. Keyed on the user. `enabled` stays false until auth resolves (the
	// consumer gates it on `!isAuthLoading`), so this reads the correct per-user
	// slot on its first run rather than racing the anonymous slot; it re-runs if
	// the user id later changes (a login mid-compose).
	useEffect(() => {
		if (!enabled || restoredKeys.current.has(storageKey)) return
		restoredKeys.current.add(storageKey)

		let cancelled = false
		void loadComposerDraft(userId).then((stored) => {
			if (cancelled || !stored) return
			// The composer filled up while we were reading. Their typing wins.
			if (!latest.current.isEmpty) return
			latest.current.onRestore(stored)
			setRestored(stored)
		})

		return () => {
			cancelled = true
		}
	}, [enabled, storageKey, userId])

	// Save. Also the single place that erases the stored draft, so a clear and a
	// write can never race one another.
	const previousIsEmpty = useRef(isEmpty)
	const previousUserId = useRef(userId)
	const previousMedia = useRef<Blob | null>(media)
	// Set when a logout (signed-in id → anonymous) is seen with content still in
	// the composer, so neither the debounce nor the on-hide flush copies the
	// signed-out user's words into the shared anonymous slot. Cleared once the
	// composer returns to empty — a genuinely anonymous compose then saves.
	const anonWriteBlocked = useRef(false)
	useEffect(() => {
		if (!enabled) return

		const wasEmpty = previousIsEmpty.current
		const previousId = previousUserId.current
		const mediaChanged = media !== previousMedia.current
		previousIsEmpty.current = isEmpty
		previousUserId.current = userId
		previousMedia.current = media

		// Logout: never let the signed-out user's words land in the shared
		// anonymous slot. Erase it, drop the restore notice, and block further
		// writes until the composer is cleared.
		if (previousId !== null && userId === null) {
			anonWriteBlocked.current = true
			setRestored(null)
			void clearComposerDraft(null)
			return
		}

		// Clearing the composer to empty must erase the stored draft, or deleting
		// all text/media would resurrect the last non-empty draft on the next
		// mount. Act only on a real non-empty→empty transition, never the initial
		// empty mount (which would race the restore read).
		if (isEmpty) {
			anonWriteBlocked.current = false
			if (!wasEmpty) void clearComposerDraft(userId)
			return
		}

		if (anonWriteBlocked.current) return

		// A newly attached or swapped recording lands immediately — it is the one
		// thing that cannot be recreated, and the tab may not survive another 600ms.
		if (mediaChanged && media) {
			void saveComposerDraft(userId, toRecord(text, visibility, mediaType, media))
			return
		}

		// Everything else waits for a pause in typing. When a recording is already
		// attached, a caption keystroke updates only the text fields and reuses the
		// Blob already on disk — never re-serializing a 40 MB take per character.
		const timer = setTimeout(() => {
			if (media) {
				void updateComposerDraftFields(userId, { text, visibility, mediaType })
			} else {
				void saveComposerDraft(userId, toRecord(text, visibility, mediaType, media))
			}
		}, TEXT_DEBOUNCE_MS)
		return () => clearTimeout(timer)
	}, [enabled, isEmpty, userId, media, text, visibility, mediaType])

	// Flush on the way out. A backgrounded iOS tab is killed without warning and
	// never runs another effect, so a pending debounce would die with it.
	useEffect(() => {
		if (!enabled) return

		const flush = () => {
			if (document.visibilityState !== 'hidden') return
			// Same logout guard as the save effect: don't let an on-hide flush copy a
			// signed-out user's words into the shared anonymous slot.
			if (anonWriteBlocked.current) return
			const current = latest.current
			if (current.isEmpty) return
			void saveComposerDraft(
				userId,
				toRecord(current.text, current.visibility, current.mediaType, current.media)
			)
		}
		document.addEventListener('visibilitychange', flush)
		return () => document.removeEventListener('visibilitychange', flush)
	}, [enabled, userId])

	/** Forget the stored draft — on a successful post, or an explicit discard. */
	const clear = useCallback(() => {
		setRestored(null)
		void clearComposerDraft(userId)
	}, [userId])

	/** Dismiss the "restored" notice without touching what is in the composer. */
	const acknowledgeRestore = useCallback(() => setRestored(null), [])

	return { restored, clear, acknowledgeRestore }
}
