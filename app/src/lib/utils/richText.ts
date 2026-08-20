// Markdown-lite inline formatting for post text: **bold** and *italic*.
//
// Markers are stored literally in the post body (not as HTML), so the text
// degrades gracefully when unstyled, stays searchable/exportable as plain text,
// and survives the existing DOMPurify sanitize pipeline. The renderer turns the
// markers into <strong>/<em>; the composer wraps the current selection.

// The content between markers must begin and end with a non-space, non-`*`
// character (CommonMark-style flanking), so ordinary prose like `2 * 3 * 4` or
// `a * b` is left alone — important because rendering applies retroactively to
// every existing post. `[^*\n]` keeps a match on one line and out of adjacent
// bold markers. Bold is matched before italic so `**x**` isn't eaten by the
// single-`*` rule. (Written without lookbehind for older-Safari support.)
const EDGE = '[^\\s*\\n]' // a non-space, non-`*` boundary character
const INNER = `(${EDGE}|${EDGE}[^*\\n]*?${EDGE})` // one char, or non-space...non-space
const BOLD_PATTERN = new RegExp(`\\*\\*${INNER}\\*\\*`, 'g')
const ITALIC_PATTERN = new RegExp(`\\*${INNER}\\*`, 'g')

/**
 * Render `**bold**` / `*italic*` markers as `<strong>` / `<em>`.
 *
 * Takes the raw post text and returns UNSANITIZED HTML. Only the markers become
 * tags; everything between them is copied through untouched, so any markup the
 * author typed is still sitting in the output. Do not hand this straight to
 * dangerouslySetInnerHTML. The caller sanitizes once at the end, after this and
 * the line-break, autolink and hashtag passes have all run, so that what reaches
 * the DOM is exactly the string the allow-list filtered — see FormatText in
 * components/post/Post.tsx.
 *
 * Bold runs before italic. Known limitation: a `*` inside a URL can still pair
 * with a later `*` on the same line (the URL linkifier runs afterwards); rare
 * enough to accept, and it matches how ordinary markdown editors behave.
 */
export function renderInlineMarkdown(raw: string): string {
	return raw.replace(BOLD_PATTERN, '<strong>$1</strong>').replace(ITALIC_PATTERN, '<em>$1</em>')
}

export interface MarkerResult {
	value: string
	start: number
	end: number
}

/**
 * Toggle a wrapping `marker` (`**` or `*`) around the `[start, end)` selection
 * in `value`, returning the new value and the selection to restore.
 *
 * - Selection already wrapped inside (`**bold**` selected) → unwrap.
 * - Markers hugging the selection (`**` outside `bold`) → unwrap.
 * - Otherwise wrap, keeping the same text selected.
 * - Empty selection → insert an empty pair with the caret between the markers.
 *
 * Italic (`*`) never unwraps something that is really a `**` bold marker: an
 * adjacent extra `*` means bold, so we wrap instead of stripping a bold layer.
 */
export function toggleMarker(
	value: string,
	start: number,
	end: number,
	marker: string
): MarkerResult {
	const selected = value.slice(start, end)
	const m = marker.length
	const isItalic = marker === '*'

	// Case 1: the markers are inside the selection — "**bold**" is highlighted.
	const innerWrapped =
		selected.length >= 2 * m &&
		selected.startsWith(marker) &&
		selected.endsWith(marker) &&
		!(isItalic && (selected.startsWith('**') || selected.endsWith('**')))
	if (innerWrapped) {
		const inner = selected.slice(m, selected.length - m)
		return {
			value: value.slice(0, start) + inner + value.slice(end),
			start,
			end: start + inner.length,
		}
	}

	// Case 2: the markers hug the selection — **[bold]** with markers outside it.
	const outerWrapped =
		start >= m &&
		value.slice(start - m, start) === marker &&
		value.slice(end, end + m) === marker &&
		!(isItalic && (value[start - m - 1] === '*' || value[end + m] === '*'))
	if (outerWrapped) {
		return {
			value: value.slice(0, start - m) + selected + value.slice(end + m),
			start: start - m,
			end: end - m,
		}
	}

	// Case 3: wrap. With an empty selection this leaves the caret between markers.
	return {
		value: value.slice(0, start) + marker + selected + marker + value.slice(end),
		start: start + m,
		end: end + m,
	}
}

const MARKERS: Record<string, string> = { b: '**', i: '*' }

/**
 * Handle a ⌘/Ctrl+B / ⌘/Ctrl+I shortcut on a textarea. Reads the live
 * selection off the event target, applies {@link toggleMarker}, pushes the new
 * value through `setValue`, and restores the selection after React re-renders.
 * Returns true when the event was a formatting shortcut (and was handled).
 */
export function applyMarkdownShortcut(
	e: React.KeyboardEvent<HTMLTextAreaElement>,
	setValue: (value: string) => void
): boolean {
	if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false
	const marker = MARKERS[e.key.toLowerCase()]
	if (!marker) return false

	e.preventDefault()
	const el = e.currentTarget
	const { value, start, end } = toggleMarker(el.value, el.selectionStart, el.selectionEnd, marker)
	setValue(value)
	requestAnimationFrame(() => {
		el.focus()
		el.setSelectionRange(start, end)
	})
	return true
}
