import { describe, expect, it } from 'vitest'
import { makeAuthor, makeMedia, makePost } from '@/__tests__/data/mockPosts'
import { parseFilterToken, postMatchesFilterSet, splitFilterInput } from '@/utils/filterQuery'

const posts = [
	makePost({
		id: 1,
		author: makeAuthor({ username: 'Maya' }),
		head: 'Deep work',
		body: 'Notes about focus and #writing',
	}),
	makePost({
		id: 2,
		author: makeAuthor({ username: 'noah' }),
		head: 'Draft plan',
		body: 'A private idea #draft',
	}),
	makePost({
		id: 3,
		author: makeAuthor({ username: 'sounddesk' }),
		head: 'Audio notes',
		body: 'Field recording',
		media: makeMedia({
			transcript: 'A transcript about deep work',
			alt_text: 'Waveform image',
		}),
	}),
]

const parseAll = (tokens: string[]) => tokens.map(parseFilterToken)

describe('filter query utilities', () => {
	describe('splitFilterInput', () => {
		it('keeps quoted strings and negated quoted strings together', () => {
			expect(splitFilterInput('alpha "deep work" -"private note" #writing')).toEqual([
				'alpha',
				'"deep work"',
				'-"private note"',
				'#writing',
			])
		})

		it('treats an unbalanced quote as a plain trailing token', () => {
			expect(splitFilterInput('alpha "deep work')).toEqual(['alpha', 'deep work'])
			expect(splitFilterInput('alpha -"deep work')).toEqual(['alpha', '-deep work'])
		})

		it('strips empty tokens and dedupes raw forms case-insensitively', () => {
			expect(splitFilterInput('  #Tag  #tag  AUTHOR:Maya author:maya  ')).toEqual([
				'#Tag',
				'AUTHOR:Maya',
			])
		})
	})

	describe('parseFilterToken', () => {
		it('parses text, tag, author, phrase, and negated forms', () => {
			expect(parseFilterToken('word')).toEqual({
				negated: false,
				kind: 'text',
				value: 'word',
				raw: 'word',
			})
			expect(parseFilterToken('#Tag')).toEqual({
				negated: false,
				kind: 'tag',
				value: 'Tag',
				raw: '#Tag',
			})
			expect(parseFilterToken('author:Maya')).toEqual({
				negated: false,
				kind: 'author',
				value: 'Maya',
				raw: 'author:Maya',
			})
			expect(parseFilterToken('"deep work"')).toEqual({
				negated: false,
				kind: 'text',
				value: 'deep work',
				raw: '"deep work"',
			})
			expect(parseFilterToken('-"deep work"')).toEqual({
				negated: true,
				kind: 'text',
				value: 'deep work',
				raw: '-"deep work"',
			})
			expect(parseFilterToken('-#draft')).toEqual({
				negated: true,
				kind: 'tag',
				value: 'draft',
				raw: '-#draft',
			})
		})
	})

	describe('postMatchesFilterSet', () => {
		it('matches all positive filters in AND mode', () => {
			const filters = parseAll(['"deep work"', '#writing'])
			const matchingIds = posts
				.filter((post) => postMatchesFilterSet(post, filters, 'and'))
				.map((post) => post.id)

			expect(matchingIds).toEqual([1])
		})

		it('matches any positive filter in OR mode', () => {
			const filters = parseAll(['#writing', 'waveform'])
			const matchingIds = posts
				.filter((post) => postMatchesFilterSet(post, filters, 'or'))
				.map((post) => post.id)

			expect(matchingIds).toEqual([1, 3])
		})

		it('keeps exclusions conjunctive regardless of match mode', () => {
			const filters = parseAll(['deep', 'draft', '-author:maya'])
			const matchingIds = posts
				.filter((post) => postMatchesFilterSet(post, filters, 'or'))
				.map((post) => post.id)

			expect(matchingIds).toEqual([2, 3])
		})

		it('supports only-exclusion filter sets and negative tags', () => {
			const filters = parseAll(['-#draft'])
			const matchingIds = posts
				.filter((post) => postMatchesFilterSet(post, filters, 'and'))
				.map((post) => post.id)

			expect(matchingIds).toEqual([1, 3])
		})

		it('matches author names case-insensitively and phrases with spaces', () => {
			const filters = parseAll(['author:maya', '"deep work"'])
			const matchingIds = posts
				.filter((post) => postMatchesFilterSet(post, filters, 'and'))
				.map((post) => post.id)

			expect(matchingIds).toEqual([1])
		})
	})
})
