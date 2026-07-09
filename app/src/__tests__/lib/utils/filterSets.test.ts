import { beforeEach, describe, expect, it } from 'vitest'
import {
	deleteNamedFilterSet,
	FILTER_SETS_STORAGE_KEY,
	getFilterSets,
	MAX_RECENT_FILTER_SETS,
	MAX_SAVED_FILTER_SETS,
	recordRecentFilterSet,
	saveNamedFilterSet,
} from '@/lib/utils/filterSets'

describe('filter set storage', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	it('saves and deletes named filter sets', () => {
		const afterSave = saveNamedFilterSet('Writing', {
			tokens: ['#writing', 'author:maya'],
			matchMode: 'and',
		})

		expect(afterSave.saved).toHaveLength(1)
		expect(afterSave.saved[0]).toMatchObject({
			name: 'Writing',
			tokens: ['#writing', 'author:maya'],
			matchMode: 'and',
		})

		const afterDelete = deleteNamedFilterSet(afterSave.saved[0].createdAt)

		expect(afterDelete.saved).toEqual([])
		expect(getFilterSets().saved).toEqual([])
	})

	it('caps saved filter sets', () => {
		for (let index = 0; index < MAX_SAVED_FILTER_SETS + 2; index += 1) {
			saveNamedFilterSet(`Set ${index}`, {
				tokens: [`token-${index}`],
				matchMode: 'and',
			})
		}

		const saved = getFilterSets().saved

		expect(saved).toHaveLength(MAX_SAVED_FILTER_SETS)
		expect(saved[0].name).toBe(`Set ${MAX_SAVED_FILTER_SETS + 1}`)
	})

	it('dedupes recent filter sets by token set and caps them', () => {
		recordRecentFilterSet({ tokens: ['alpha', 'beta'], matchMode: 'and' })
		recordRecentFilterSet({ tokens: ['BETA', 'ALPHA'], matchMode: 'or' })

		for (let index = 0; index < MAX_RECENT_FILTER_SETS + 1; index += 1) {
			recordRecentFilterSet({
				tokens: [`token-${index}`],
				matchMode: index % 2 === 0 ? 'and' : 'or',
			})
		}

		const recent = getFilterSets().recent

		expect(recent).toHaveLength(MAX_RECENT_FILTER_SETS)
		expect(recent[0].tokens).toEqual([`token-${MAX_RECENT_FILTER_SETS}`])
		expect(recent.at(-1)?.tokens).toEqual(['token-1'])
	})

	it('does not record empty recent filter sets', () => {
		recordRecentFilterSet({ tokens: [], matchMode: 'and' })

		expect(localStorage.getItem(FILTER_SETS_STORAGE_KEY)).toBeNull()
		expect(getFilterSets().recent).toEqual([])
	})
})
