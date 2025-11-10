import { useCallback, useMemo, useState } from 'react'
import type { Post } from '@/types/post'

export type FilterToken = { token: string; enabled: boolean }

export type MatchMode = 'and' | 'or'

export const normalizeFilterToken = (token: string) => token.trim().toLowerCase()

export const sanitizeTokens = (rawInput: string) =>
	Array.from(
		new Set(
			rawInput
				.trim()
				.split(/\s+/)
				.map((token) => token.trim())
				.filter(Boolean)
		)
	)

export const formatTagToken = (tag: string) => (tag.startsWith('#') ? tag : `#${tag}`)

const createMatcher =
	(matchMode: MatchMode, filters: FilterToken[]) =>
		(fn: (filter: FilterToken) => boolean) =>
			matchMode === 'and' ? filters.every(fn) : filters.some(fn)

const shouldEnableFilter = (filter: FilterToken, tokens: string[]) =>
	tokens.some((token) => normalizeFilterToken(token) === normalizeFilterToken(filter.token))

export const usePostFilters = (posts: Post[]) => {
	const [filterText, setFilterText] = useState('')
	const [filters, setFilters] = useState<FilterToken[]>([])
	const [matchMode, setMatchMode] = useState<MatchMode>('and')

	const activeFilters = useMemo(() => filters.filter((filter) => filter.enabled), [filters])

	const filteredPosts = useMemo(() => {
		if (activeFilters.length === 0) {
			return posts
		}

		return posts.filter((post) => {
			const fieldsToSearch: Array<string | undefined | null> = [
				post.head,
				post.body,
				post.media?.transcript,
				post.media?.alt_text,
			]

			const matcher = createMatcher(matchMode, activeFilters)

			return matcher((filter) => {
				const normalizedFilter = normalizeFilterToken(filter.token)
				return fieldsToSearch.some((field) => field?.toLowerCase().includes(normalizedFilter))
			})
		})
	}, [activeFilters, matchMode, posts])

	const tagFilters = useMemo(
		() => filters.filter((filter) => filter.token.trim().startsWith('#')),
		[filters]
	)

	const totalPostCount = posts.length
	const filteredPostCount = filteredPosts.length

	const postCountLabel = useMemo(() => {
		const baseCountText = `${filteredPostCount} ${filteredPostCount === 1 ? 'post' : 'posts'}`

		if (filteredPostCount === totalPostCount) {
			return `Showing ${baseCountText}`
		}

		return `Showing ${baseCountText} (filtered)`
	}, [filteredPostCount, totalPostCount])

	const addFiltersFromText = useCallback((input: string) => {
		const tokens = sanitizeTokens(input)

		if (tokens.length === 0) {
			return
		}

		setFilters((prev) => {
			if (prev.length === 0) {
				return tokens.map((token) => ({
					token,
					enabled: true,
				}))
			}

			const existingMap = new Map(prev.map((filter) => [normalizeFilterToken(filter.token), filter]))

			const updatedFilters = prev.map((filter) =>
				shouldEnableFilter(filter, tokens) ? { ...filter, enabled: true } : filter
			)

			const nextTokens = tokens.filter((token) => !existingMap.has(normalizeFilterToken(token)))

			if (nextTokens.length === 0) {
				return updatedFilters
			}

			return [
				...updatedFilters,
				...nextTokens.map((token) => ({
					token,
					enabled: true,
				})),
			]
		})

		setFilterText('')
	}, [])

	const removeFilter = useCallback((tokenToRemove: string) => {
		setFilters((prev) => prev.filter((filter) => filter.token !== tokenToRemove))
	}, [])

	const clearFilters = useCallback(() => {
		setFilters([])
	}, [])

	const toggleFilter = useCallback((tokenToToggle: string) => {
		setFilters((prev) =>
			prev.map((filter) =>
				filter.token === tokenToToggle ? { ...filter, enabled: !filter.enabled } : filter
			)
		)
	}, [])

	const applyTagFilters = useCallback((tags: string[]) => {
		setFilters((prev) => {
			const nonTagFilters = prev.filter((filter) => !filter.token.trim().startsWith('#'))

			const nextTagFilters = tags.map((tag) => ({
				token: formatTagToken(tag),
				enabled: true,
			}))

			return [...nonTagFilters, ...nextTagFilters]
		})
	}, [])

	return {
		filterText,
		setFilterText,
		filters,
		tagFilters,
		matchMode,
		setMatchMode,
		filteredPosts,
		totalPostCount,
		filteredPostCount,
		postCountLabel,
		addFiltersFromText,
		removeFilter,
		clearFilters,
		toggleFilter,
		applyTagFilters,
	}
}
