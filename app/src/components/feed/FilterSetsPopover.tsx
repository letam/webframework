import type React from 'react'
import { useMemo, useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { FilterToken, MatchMode } from '@/hooks/usePostFilters'
import {
	deleteNamedFilterSet,
	type FilterSetSnapshot,
	getFilterSets,
	saveNamedFilterSet,
	type StoredFilterSets,
} from '@/lib/utils/filterSets'
import { cn } from '@/lib/utils'

type FilterSetsPopoverProps = {
	filters: FilterToken[]
	matchMode: MatchMode
	onApply: (snapshot: FilterSetSnapshot) => void
	disabled?: boolean
}

const joinTokens = (tokens: string[]) => tokens.join(' ')

const emptyFilterSets: StoredFilterSets = {
	saved: [],
	recent: [],
}

export const FilterSetsPopover: React.FC<FilterSetsPopoverProps> = ({
	filters,
	matchMode,
	onApply,
	disabled = false,
}) => {
	const [isOpen, setIsOpen] = useState(false)
	const [filterSets, setFilterSets] = useState<StoredFilterSets>(emptyFilterSets)
	const [name, setName] = useState('')

	const activeSnapshot = useMemo<FilterSetSnapshot>(
		() => ({
			tokens: filters.filter((filter) => filter.enabled).map((filter) => filter.token),
			matchMode,
		}),
		[filters, matchMode]
	)
	const hasActiveFilters = activeSnapshot.tokens.length > 0

	const handleOpenChange = (nextOpen: boolean) => {
		if (nextOpen) {
			setFilterSets(getFilterSets())
		}

		setIsOpen(nextOpen)
	}

	const handleSave = () => {
		const next = saveNamedFilterSet(name, activeSnapshot)
		setFilterSets(next)
		setName('')
	}

	const handleDelete = (createdAt: string) => {
		setFilterSets(deleteNamedFilterSet(createdAt))
	}

	const handleApply = (snapshot: FilterSetSnapshot) => {
		onApply(snapshot)
		setIsOpen(false)
	}

	return (
		<Popover open={isOpen} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className={cn('h-9 w-9 rounded-full', hasActiveFilters && 'text-primary')}
					aria-label="Saved filters"
					disabled={disabled}
				>
					<Bookmark className="size-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-80" align="end" sideOffset={8}>
				<div className="flex flex-col gap-4">
					{hasActiveFilters ? (
						<div className="space-y-2">
							<h3 className="text-sm font-medium text-foreground">Save current filters</h3>
							<div className="flex items-center gap-2">
								<input
									className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm transition-colors focus:border-ring focus:outline-hidden focus:ring-2 focus:ring-ring/40"
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder="Filter set name"
									aria-label="Filter set name"
								/>
								<Button type="button" size="sm" onClick={handleSave} disabled={!name.trim()}>
									Save
								</Button>
							</div>
						</div>
					) : null}

					<div className="space-y-2">
						<h3 className="text-sm font-medium text-foreground">Saved</h3>
						{filterSets.saved.length === 0 ? (
							<p className="text-sm text-muted-foreground">No saved filters yet.</p>
						) : (
							<div className="space-y-1">
								{filterSets.saved.map((filterSet) => (
									<div key={filterSet.createdAt} className="flex items-center gap-1">
										<button
											type="button"
											className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
											onClick={() => handleApply(filterSet)}
										>
											<span className="block truncate text-sm font-medium">{filterSet.name}</span>
											<span className="block truncate text-xs text-muted-foreground">
												{joinTokens(filterSet.tokens)}
											</span>
										</button>
										<button
											type="button"
											className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
											onClick={(event) => {
												event.stopPropagation()
												handleDelete(filterSet.createdAt)
											}}
											aria-label={`Delete saved filter ${filterSet.name}`}
										>
											<X className="size-4" />
										</button>
									</div>
								))}
							</div>
						)}
					</div>

					<div className="space-y-2">
						<h3 className="text-sm font-medium text-foreground">Recent</h3>
						{filterSets.recent.length === 0 ? (
							<p className="text-sm text-muted-foreground">No recent filters yet.</p>
						) : (
							<div className="space-y-1">
								{filterSets.recent.map((filterSet) => (
									<button
										key={`${filterSet.matchMode}:${joinTokens(filterSet.tokens)}`}
										type="button"
										className="w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
										onClick={() => handleApply(filterSet)}
									>
										<span className="block truncate">{joinTokens(filterSet.tokens)}</span>
									</button>
								))}
							</div>
						)}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
