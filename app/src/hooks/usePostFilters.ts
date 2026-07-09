import { useCallback, useEffect, useMemo, useState } from 'react'
import { recordRecentFilterSet, type FilterSetSnapshot } from '@/lib/utils/filterSets'
import type { Post } from '@/types/post'
import { parseFilterToken, postMatchesFilterSet, splitFilterInput } from '@/utils/filterQuery'

export type FilterToken = { token: string; enabled: boolean }

export type MatchMode = 'and' | 'or'

export const normalizeFilterToken = (token: string) => token.trim().toLowerCase()

export const sanitizeTokens = (rawInput: string) => splitFilterInput(rawInput)

const sanitizeTokenList = (tokens: string[]) =>
	Array.from(
		new Map(
			tokens
				.map((token) => token.trim())
				.filter(Boolean)
				.map((token) => [normalizeFilterToken(token), token])
		).values()
	)

export const formatTagToken = (tag: string) => (tag.startsWith('#') ? tag : `#${tag}`)

const shouldEnableFilter = (filter: FilterToken, tokens: string[]) =>
	tokens.some((token) => normalizeFilterToken(token) === normalizeFilterToken(filter.token))

export const usePostFilters = (posts: Post[]) => {
	const [filterText, setFilterText] = useState('')
	const [filters, setFilters] = useState<FilterToken[]>([])
	const [matchMode, setMatchMode] = useState<MatchMode>('and')

	const activeFilters = useMemo(() => filters.filter((filter) => filter.enabled), [filters])

	const activeFilterTokens = useMemo(
		() => activeFilters.map((filter) => filter.token),
		[activeFilters]
	)

	const filteredPosts = useMemo(() => {
		if (activeFilters.length === 0) {
			return posts
		}

		const parsedFilters = activeFilters.map((filter) => parseFilterToken(filter.token))

		return posts.filter((post) => {
			return postMatchesFilterSet(post, parsedFilters, matchMode)
		})
	}, [activeFilters, matchMode, posts])

	const tagFilters = useMemo(
		() =>
			filters.filter((filter) => {
				const parsed = parseFilterToken(filter.token)
				return !parsed.negated && parsed.kind === 'tag'
			}),
		[filters]
	)

	useEffect(() => {
		recordRecentFilterSet({ tokens: activeFilterTokens, matchMode })
	}, [activeFilterTokens, matchMode])

	const totalPostCount = posts.length
	const filteredPostCount = filteredPosts.length

	// Only worth surfacing while filters are narrowing the feed
	const postCountLabel = useMemo(() => {
		if (activeFilters.length === 0) {
			return ''
		}

		return `Showing ${filteredPostCount} of ${totalPostCount} ${totalPostCount === 1 ? 'post' : 'posts'}`
	}, [activeFilters, filteredPostCount, totalPostCount])

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

			const existingMap = new Map(
				prev.map((filter) => [normalizeFilterToken(filter.token), filter])
			)

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
			const nonTagFilters = prev.filter((filter) => {
				const parsed = parseFilterToken(filter.token)
				return parsed.negated || parsed.kind !== 'tag'
			})

			const nextTagFilters = tags.map((tag) => ({
				token: formatTagToken(tag),
				enabled: true,
			}))

			return [...nonTagFilters, ...nextTagFilters]
		})
	}, [])

	const applyFilterSet = useCallback((snapshot: FilterSetSnapshot) => {
		const tokens = sanitizeTokenList(snapshot.tokens)

		setFilters(tokens.map((token) => ({ token, enabled: true })))
		setMatchMode(snapshot.matchMode)
		setFilterText('')
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
		applyFilterSet,
	}
}
