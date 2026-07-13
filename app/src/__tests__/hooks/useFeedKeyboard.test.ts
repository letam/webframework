import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type FeedKeyboardActions, useFeedKeyboard } from '@/hooks/useFeedKeyboard'

const makeActions = (overrides: Partial<FeedKeyboardActions> = {}): FeedKeyboardActions => ({
	postCount: 3,
	onLike: vi.fn(),
	onOpen: vi.fn(),
	onCompose: vi.fn(),
	onFocusFilter: vi.fn(),
	onShowHelp: vi.fn(),
	onJumpToTop: vi.fn(),
	...overrides,
})

// Default target is <body>, matching a real browser when nothing is focused.
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
	act(() => {
		target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
	})
}

describe('useFeedKeyboard', () => {
	afterEach(() => {
		document.body.replaceChildren()
	})

	it('advances and clamps the selection with j', () => {
		const { result } = renderHook(() => useFeedKeyboard(makeActions({ postCount: 2 })))
		expect(result.current.focusedIndex).toBe(-1)

		press('j')
		expect(result.current.focusedIndex).toBe(0)
		press('j')
		expect(result.current.focusedIndex).toBe(1)
		press('j')
		expect(result.current.focusedIndex).toBe(1) // clamped at the last post
	})

	it('moves back and clamps the selection with k', () => {
		const { result } = renderHook(() => useFeedKeyboard(makeActions()))
		press('j')
		press('j')
		expect(result.current.focusedIndex).toBe(1)
		press('k')
		expect(result.current.focusedIndex).toBe(0)
		press('k')
		expect(result.current.focusedIndex).toBe(0) // clamped at the first post
	})

	it('likes the focused post, and does nothing when none is focused', () => {
		const actions = makeActions()
		renderHook(() => useFeedKeyboard(actions))

		press('l')
		expect(actions.onLike).not.toHaveBeenCalled()

		press('j') // focus index 0
		press('j') // focus index 1
		press('l')
		expect(actions.onLike).toHaveBeenCalledWith(1)
	})

	it('opens the focused post with o and Enter', () => {
		const actions = makeActions()
		renderHook(() => useFeedKeyboard(actions))
		press('j')
		press('o')
		expect(actions.onOpen).toHaveBeenCalledWith(0)
		press('Enter')
		expect(actions.onOpen).toHaveBeenCalledTimes(2)
	})

	it('lets Enter fall through to a focused control', () => {
		const actions = makeActions()
		renderHook(() => useFeedKeyboard(actions))
		const button = document.createElement('button')
		document.body.appendChild(button)

		press('j') // focus index 0
		press('Enter', {}, button) // Enter on a real button must not open the post
		expect(actions.onOpen).not.toHaveBeenCalled()
	})

	it('does not repeat-fire the like action when the key is held', () => {
		const actions = makeActions()
		renderHook(() => useFeedKeyboard(actions))
		press('j') // focus index 0
		press('l', { repeat: true })
		expect(actions.onLike).not.toHaveBeenCalled()
		press('l')
		expect(actions.onLike).toHaveBeenCalledTimes(1)
	})

	it('stays out of the way while an overlay owns the keyboard', () => {
		const actions = makeActions()
		const { result } = renderHook(() => useFeedKeyboard(actions))
		const dialog = document.createElement('div')
		dialog.setAttribute('role', 'dialog')
		const inner = document.createElement('button')
		dialog.appendChild(inner)
		document.body.appendChild(dialog)

		press('j', {}, inner)
		expect(result.current.focusedIndex).toBe(-1)
		press('l', {}, inner)
		expect(actions.onLike).not.toHaveBeenCalled()
	})

	it('does not arm a selection with k on an empty feed', () => {
		const { result } = renderHook(() => useFeedKeyboard(makeActions({ postCount: 0 })))
		press('k')
		expect(result.current.focusedIndex).toBe(-1)
		press('j')
		expect(result.current.focusedIndex).toBe(-1)
	})

	it('fires the global shortcuts', () => {
		const actions = makeActions()
		renderHook(() => useFeedKeyboard(actions))
		press('/')
		expect(actions.onFocusFilter).toHaveBeenCalled()
		press('n')
		expect(actions.onCompose).toHaveBeenCalled()
		press('?', { shiftKey: true })
		expect(actions.onShowHelp).toHaveBeenCalled()
	})

	it('jumps to the top on a double-g and resets the selection', () => {
		const actions = makeActions()
		const { result } = renderHook(() => useFeedKeyboard(actions))
		press('j')
		press('j')
		press('g')
		press('g')
		expect(actions.onJumpToTop).toHaveBeenCalled()
		expect(result.current.focusedIndex).toBe(0)
	})

	it('clears the selection on Escape', () => {
		const { result } = renderHook(() => useFeedKeyboard(makeActions()))
		press('j')
		expect(result.current.focusedIndex).toBe(0)
		press('Escape')
		expect(result.current.focusedIndex).toBe(-1)
	})

	it('ignores shortcuts while typing in a field', () => {
		const actions = makeActions()
		const { result } = renderHook(() => useFeedKeyboard(actions))
		const input = document.createElement('input')
		document.body.appendChild(input)

		press('j', {}, input)
		expect(result.current.focusedIndex).toBe(-1)
		press('l', {}, input)
		expect(actions.onLike).not.toHaveBeenCalled()
	})

	it('ignores keys pressed with a meta or ctrl modifier', () => {
		const actions = makeActions()
		const { result } = renderHook(() => useFeedKeyboard(actions))
		press('j', { metaKey: true })
		press('n', { ctrlKey: true })
		expect(result.current.focusedIndex).toBe(-1)
		expect(actions.onCompose).not.toHaveBeenCalled()
	})

	it('clamps the selection when the feed shrinks', () => {
		const { result, rerender } = renderHook(
			(props: FeedKeyboardActions) => useFeedKeyboard(props),
			{
				initialProps: makeActions({ postCount: 3 }),
			}
		)
		press('j')
		press('j')
		press('j')
		expect(result.current.focusedIndex).toBe(2)

		rerender(makeActions({ postCount: 1 }))
		expect(result.current.focusedIndex).toBe(0)
	})
})
