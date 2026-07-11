import { describe, expect, it } from 'vitest'
import { renderInlineMarkdown, toggleMarker } from '@/lib/utils/richText'

describe('renderInlineMarkdown', () => {
	it('renders **bold** as <strong>', () => {
		expect(renderInlineMarkdown('a **big** deal')).toBe('a <strong>big</strong> deal')
	})

	it('renders *italic* as <em>', () => {
		expect(renderInlineMarkdown('an *odd* one')).toBe('an <em>odd</em> one')
	})

	it('handles bold and italic together without cross-matching', () => {
		expect(renderInlineMarkdown('**bold** and *italic*')).toBe(
			'<strong>bold</strong> and <em>italic</em>'
		)
	})

	it('leaves a lone asterisk untouched', () => {
		expect(renderInlineMarkdown('2 * 3 = 6')).toBe('2 * 3 = 6')
	})

	it('does not italicize space-flanked asterisks in prose', () => {
		// The classic false positive: two multiplications on one line.
		expect(renderInlineMarkdown('2 * 3 * 4')).toBe('2 * 3 * 4')
		expect(renderInlineMarkdown('a * b and c * d')).toBe('a * b and c * d')
	})

	it('does not bold space-flanked double asterisks', () => {
		expect(renderInlineMarkdown('** hi **')).toBe('** hi **')
	})

	it('formats a single-character emphasis', () => {
		expect(renderInlineMarkdown('*a* and **b**')).toBe('<em>a</em> and <strong>b</strong>')
	})

	it('does not span across newlines', () => {
		expect(renderInlineMarkdown('*a\nb*')).toBe('*a\nb*')
	})

	it('passes plain text through unchanged', () => {
		expect(renderInlineMarkdown('nothing to format')).toBe('nothing to format')
	})
})

describe('toggleMarker', () => {
	it('wraps the selection and keeps the same text selected', () => {
		// "world" selected in "hello world"
		const r = toggleMarker('hello world', 6, 11, '**')
		expect(r.value).toBe('hello **world**')
		expect(r.value.slice(r.start, r.end)).toBe('world')
	})

	it('unwraps when the selection already includes the markers', () => {
		// "**world**" selected
		const r = toggleMarker('hello **world**', 6, 15, '**')
		expect(r.value).toBe('hello world')
		expect(r.value.slice(r.start, r.end)).toBe('world')
	})

	it('unwraps when the markers hug the selection', () => {
		// only "world" selected, markers sit just outside
		const r = toggleMarker('hello **world**', 8, 13, '**')
		expect(r.value).toBe('hello world')
		expect(r.value.slice(r.start, r.end)).toBe('world')
	})

	it('inserts an empty pair with the caret between on an empty selection', () => {
		const r = toggleMarker('hi ', 3, 3, '*')
		expect(r.value).toBe('hi **')
		expect(r.start).toBe(4)
		expect(r.end).toBe(4)
	})

	it('does not treat a bold pair as an italic toggle', () => {
		// "**world**" selected, italic requested → wrap, not strip a bold layer
		const r = toggleMarker('hello **world**', 6, 15, '*')
		expect(r.value).toBe('hello ***world***')
		expect(r.value.slice(r.start, r.end)).toBe('**world**')
	})

	it('round-trips wrap then unwrap', () => {
		const wrapped = toggleMarker('abc', 0, 3, '*')
		expect(wrapped.value).toBe('*abc*')
		const unwrapped = toggleMarker(wrapped.value, wrapped.start, wrapped.end, '*')
		expect(unwrapped.value).toBe('abc')
	})
})
