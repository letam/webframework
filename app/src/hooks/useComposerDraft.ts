import { useCallback, useEffect, useRef, useState } from 'react'
import type { PostVisibility } from '@/types/post'
import {
	type ComposerDraft,
	type ComposerMediaType,
	clearComposerDraft,
	draftKeyForUser,
	loadComposerDraft,
	saveComposerDraft,
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

	// Restore. Keyed on the user, because auth resolves after mount: the first
	// pass reads the anonymous slot, and a second runs once a real user id
	// arrives.
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

	// Save.
	useEffect(() => {
		if (!enabled || isEmpty) return

		const write = () => void saveComposerDraft(userId, toRecord(text, visibility, mediaType, media))

		// Media lands immediately — a recording is the one thing that cannot be
		// recreated, and the tab may not survive another 600ms. Text waits for a
		// pause in typing.
		if (media) {
			write()
			return
		}
		const timer = setTimeout(write, TEXT_DEBOUNCE_MS)
		return () => clearTimeout(timer)
	}, [enabled, isEmpty, userId, media, text, visibility, mediaType])

	// Flush on the way out. A backgrounded iOS tab is killed without warning and
	// never runs another effect, so a pending debounce would die with it.
	useEffect(() => {
		if (!enabled) return

		const flush = () => {
			if (document.visibilityState !== 'hidden') return
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
