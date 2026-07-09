import type { MatchMode } from '@/hooks/usePostFilters'

export const FILTER_SETS_STORAGE_KEY = 'app-filter-sets'
export const MAX_SAVED_FILTER_SETS = 20
export const MAX_RECENT_FILTER_SETS = 5

export type FilterSetSnapshot = {
	tokens: string[]
	matchMode: MatchMode
}

export type NamedFilterSet = FilterSetSnapshot & {
	name: string
	createdAt: string
}

export type StoredFilterSets = {
	saved: NamedFilterSet[]
	recent: FilterSetSnapshot[]
}

const emptyFilterSets: StoredFilterSets = {
	saved: [],
	recent: [],
}

const normalizeTokenSet = (tokens: string[]) =>
	tokens
		.map((token) => token.trim().toLowerCase())
		.filter(Boolean)
		.sort()
		.join('\n')

const normalizeSnapshot = (snapshot: FilterSetSnapshot): FilterSetSnapshot => ({
	tokens: snapshot.tokens.map((token) => token.trim()).filter(Boolean),
	matchMode: snapshot.matchMode,
})

const hasTokens = (snapshot: FilterSetSnapshot) => normalizeSnapshot(snapshot).tokens.length > 0

const sameTokenSet = (first: FilterSetSnapshot, second: FilterSetSnapshot) =>
	normalizeTokenSet(first.tokens) === normalizeTokenSet(second.tokens)

const readFilterSets = (): StoredFilterSets => {
	try {
		const stored = localStorage.getItem(FILTER_SETS_STORAGE_KEY)

		if (!stored) {
			return emptyFilterSets
		}

		const parsed = JSON.parse(stored) as Partial<StoredFilterSets>

		return {
			saved: Array.isArray(parsed.saved) ? parsed.saved : [],
			recent: Array.isArray(parsed.recent) ? parsed.recent : [],
		}
	} catch (error) {
		console.error('Error reading filter sets:', error)
		return emptyFilterSets
	}
}

const writeFilterSets = (filterSets: StoredFilterSets) => {
	try {
		localStorage.setItem(FILTER_SETS_STORAGE_KEY, JSON.stringify(filterSets))
	} catch (error) {
		console.error('Error saving filter sets:', error)
	}
}

export const getFilterSets = (): StoredFilterSets => readFilterSets()

export const saveNamedFilterSet = (name: string, snapshot: FilterSetSnapshot): StoredFilterSets => {
	const normalizedName = name.trim()
	const normalizedSnapshot = normalizeSnapshot(snapshot)
	const current = readFilterSets()

	if (!normalizedName || normalizedSnapshot.tokens.length === 0) {
		return current
	}

	const next: StoredFilterSets = {
		...current,
		saved: [
			{
				...normalizedSnapshot,
				name: normalizedName,
				createdAt: new Date().toISOString(),
			},
			...current.saved,
		].slice(0, MAX_SAVED_FILTER_SETS),
	}

	writeFilterSets(next)
	return next
}

export const deleteNamedFilterSet = (createdAt: string): StoredFilterSets => {
	const current = readFilterSets()
	const next = {
		...current,
		saved: current.saved.filter((filterSet) => filterSet.createdAt !== createdAt),
	}

	writeFilterSets(next)
	return next
}

export const recordRecentFilterSet = (snapshot: FilterSetSnapshot): StoredFilterSets => {
	const normalizedSnapshot = normalizeSnapshot(snapshot)
	const current = readFilterSets()

	if (!hasTokens(normalizedSnapshot)) {
		return current
	}

	const next: StoredFilterSets = {
		...current,
		recent: [
			normalizedSnapshot,
			...current.recent.filter((recent) => !sameTokenSet(recent, normalizedSnapshot)),
		].slice(0, MAX_RECENT_FILTER_SETS),
	}

	writeFilterSets(next)
	return next
}
