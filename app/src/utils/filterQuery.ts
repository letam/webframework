import type { MatchMode } from '@/hooks/usePostFilters'
import type { Post } from '@/types/post'

export type ParsedFilterToken = {
	negated: boolean
	kind: 'text' | 'tag' | 'author'
	value: string
	raw: string
}

const normalizeRawToken = (token: string) => token.trim().toLowerCase()

const pushUniqueToken = (tokens: string[], seen: Set<string>, token: string) => {
	const trimmed = token.trim()

	if (!trimmed) {
		return
	}

	const key = normalizeRawToken(trimmed)

	if (seen.has(key)) {
		return
	}

	seen.add(key)
	tokens.push(trimmed)
}

export const splitFilterInput = (rawInput: string): string[] => {
	const tokens: string[] = []
	const seen = new Set<string>()
	let index = 0

	while (index < rawInput.length) {
		while (index < rawInput.length && /\s/.test(rawInput[index])) {
			index += 1
		}

		if (index >= rawInput.length) {
			break
		}

		const isNegatedQuote = rawInput[index] === '-' && rawInput[index + 1] === '"'
		const isQuoted = rawInput[index] === '"'

		if (isQuoted || isNegatedQuote) {
			const prefix = isNegatedQuote ? '-' : ''
			index += isNegatedQuote ? 2 : 1

			const valueStart = index

			while (index < rawInput.length && rawInput[index] !== '"') {
				index += 1
			}

			const value = rawInput.slice(valueStart, index)

			if (index < rawInput.length && rawInput[index] === '"') {
				index += 1
				pushUniqueToken(tokens, seen, `${prefix}"${value}"`)
			} else {
				pushUniqueToken(tokens, seen, `${prefix}${value}`)
			}

			continue
		}

		const tokenStart = index

		while (index < rawInput.length && !/\s/.test(rawInput[index])) {
			index += 1
		}

		pushUniqueToken(tokens, seen, rawInput.slice(tokenStart, index))
	}

	return tokens
}

export const parseFilterToken = (token: string): ParsedFilterToken => {
	const raw = token.trim()
	let negated = false
	let body = raw

	if (body.startsWith('-') && body.length > 1) {
		negated = true
		body = body.slice(1)
	}

	const isQuoted = body.startsWith('"') && body.endsWith('"') && body.length >= 2
	const valueSource = isQuoted ? body.slice(1, -1) : body
	const normalizedValueSource = valueSource.trim()
	const lowerValueSource = normalizedValueSource.toLowerCase()

	if (!isQuoted && lowerValueSource.startsWith('author:')) {
		const authorValue = normalizedValueSource.slice('author:'.length).trim()

		if (authorValue) {
			return {
				negated,
				kind: 'author',
				value: authorValue,
				raw,
			}
		}
	}

	if (!isQuoted && normalizedValueSource.startsWith('#')) {
		const tagValue = normalizedValueSource.slice(1).trim()

		if (tagValue) {
			return {
				negated,
				kind: 'tag',
				value: tagValue,
				raw,
			}
		}
	}

	return {
		negated,
		kind: 'text',
		value: isQuoted ? valueSource : normalizedValueSource,
		raw,
	}
}

const includesCaseInsensitive = (field: string | undefined | null, value: string) =>
	field?.toLowerCase().includes(value.toLowerCase()) ?? false

export const postMatchesFilterToken = (post: Post, filter: ParsedFilterToken) => {
	if (!filter.value) {
		return false
	}

	if (filter.kind === 'author') {
		return includesCaseInsensitive(post.author.username, filter.value)
	}

	const fieldsToSearch: Array<string | undefined | null> = [
		post.head,
		post.body,
		post.media?.transcript,
		post.media?.alt_text,
	]
	const value = filter.kind === 'tag' ? `#${filter.value}` : filter.value

	return fieldsToSearch.some((field) => includesCaseInsensitive(field, value))
}

export const postMatchesFilterSet = (
	post: Post,
	filters: ParsedFilterToken[],
	matchMode: MatchMode
) => {
	const exclusions = filters.filter((filter) => filter.negated)

	if (exclusions.some((filter) => postMatchesFilterToken(post, filter))) {
		return false
	}

	const positives = filters.filter((filter) => !filter.negated)

	if (positives.length === 0) {
		return true
	}

	return matchMode === 'and'
		? positives.every((filter) => postMatchesFilterToken(post, filter))
		: positives.some((filter) => postMatchesFilterToken(post, filter))
}
