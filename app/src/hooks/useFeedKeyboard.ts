import { useEffect, useRef, useState } from 'react'

// Two presses of `g` within this window jump to the top, gmail-style.
const DOUBLE_TAP_MS = 500

export interface FeedKeyboardActions {
	/** Number of posts currently rendered in the feed. */
	postCount: number
	/** Like/unlike the post at the given index. */
	onLike: (index: number) => void
	/** Open the post at the given index (its permalink). */
	onOpen: (index: number) => void
	/** Move keyboard focus into the composer. */
	onCompose: () => void
	/** Move keyboard focus into the filter/search box. */
	onFocusFilter: () => void
	/** Reveal the keyboard-shortcuts help. */
	onShowHelp: () => void
	/** Scroll the feed back to the top. */
	onJumpToTop: () => void
	/** Disable the listener (e.g. when a modal owns the keyboard). */
	enabled?: boolean
}

/** True when a keystroke should be left to the field the user is typing in. */
const isEditableTarget = (target: EventTarget | null): boolean => {
	const el = target as HTMLElement | null
	if (!el || typeof el.tagName !== 'string') {
		return false
	}
	const tag = el.tagName
	return (
		tag === 'INPUT' ||
		tag === 'TEXTAREA' ||
		tag === 'SELECT' ||
		el.isContentEditable ||
		el.getAttribute?.('role') === 'textbox'
	)
}

// Dialogs, menus and listboxes trap and own the keyboard while they are open.
const OVERLAY_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'

/** True when the keystroke happened inside an open overlay that owns the keyboard. */
const isInOverlay = (target: EventTarget | null): boolean => {
	const el = target as HTMLElement | null
	return Boolean(el?.closest?.(OVERLAY_SELECTOR))
}

/**
 * Wire up feed-wide keyboard shortcuts (j/k navigation, like, open, compose,
 * search, jump-to-top, help) and expose which post is currently focused.
 *
 * The listener is attached once and reads live props through a ref, so passing
 * fresh inline callbacks each render does not re-subscribe it.
 */
export const useFeedKeyboard = ({
	postCount,
	onLike,
	onOpen,
	onCompose,
	onFocusFilter,
	onShowHelp,
	onJumpToTop,
	enabled = true,
}: FeedKeyboardActions) => {
	const [focusedIndex, setFocusedIndex] = useState(-1)
	const lastGRef = useRef(0)

	// Keep the selection in range as the feed grows, shrinks, or is filtered.
	useEffect(() => {
		setFocusedIndex((index) => (index >= postCount ? postCount - 1 : index))
	}, [postCount])

	const stateRef = useRef({
		focusedIndex,
		postCount,
		onLike,
		onOpen,
		onCompose,
		onFocusFilter,
		onShowHelp,
		onJumpToTop,
	})
	stateRef.current = {
		focusedIndex,
		postCount,
		onLike,
		onOpen,
		onCompose,
		onFocusFilter,
		onShowHelp,
		onJumpToTop,
	}

	useEffect(() => {
		if (!enabled) {
			return
		}

		const handler = (event: KeyboardEvent) => {
			const state = stateRef.current
			const target = event.target as HTMLElement | null

			// Escape steps out: blur an active field, otherwise clear the selection.
			if (event.key === 'Escape') {
				if (isEditableTarget(target)) {
					target?.blur()
				} else if (!isInOverlay(target)) {
					setFocusedIndex(-1)
				}
				return
			}

			// Leave keystrokes to fields, open overlays, controls that already
			// handled the key, and browser/OS chords. Shift passes through so
			// `?` (Shift+/) still reaches us.
			if (
				event.defaultPrevented ||
				isEditableTarget(target) ||
				isInOverlay(target) ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			) {
				return
			}

			switch (event.key) {
				case 'j':
					event.preventDefault()
					setFocusedIndex((index) => Math.min(index < 0 ? 0 : index + 1, state.postCount - 1))
					break
				case 'k':
					event.preventDefault()
					setFocusedIndex((index) => (index <= 0 ? (state.postCount > 0 ? 0 : -1) : index - 1))
					break
				case 'l':
					if (state.focusedIndex >= 0 && !event.repeat) {
						event.preventDefault()
						state.onLike(state.focusedIndex)
					}
					break
				case 'o':
				case 'Enter':
					// Enter must yield to whatever control the user has focused; only
					// treat it as "open post" when nothing else owns the keyboard
					// (i.e. the active element is <body>). `o` has no such conflict.
					if (event.key === 'Enter' && target !== document.body) {
						return
					}
					if (state.focusedIndex >= 0 && !event.repeat) {
						event.preventDefault()
						state.onOpen(state.focusedIndex)
					}
					break
				case '/':
					event.preventDefault()
					state.onFocusFilter()
					break
				case 'n':
					event.preventDefault()
					state.onCompose()
					break
				case '?':
					event.preventDefault()
					state.onShowHelp()
					break
				case 'g': {
					if (event.timeStamp - lastGRef.current < DOUBLE_TAP_MS) {
						lastGRef.current = 0
						setFocusedIndex(state.postCount > 0 ? 0 : -1)
						state.onJumpToTop()
					} else {
						lastGRef.current = event.timeStamp
					}
					break
				}
				default:
					break
			}
		}

		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [enabled])

	return { focusedIndex, setFocusedIndex }
}
