import type React from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TagFilterPopover } from './TagFilterPopover'
import type { FilterToken, MatchMode } from '@/hooks/usePostFilters'
import { useEffect, useId, useRef } from 'react'
import { scrollToElement } from '@/lib/utils/ui'

type FilterControlsProps = {
	filterText: string
	onFilterTextChange: (value: string) => void
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
	matchMode: MatchMode
	onMatchModeChange: (mode: MatchMode) => void
	selectedTags: string[]
	onTagsSubmit: (tags: string[]) => void
	disabled?: boolean
	filters: FilterToken[]
	filteredPostCount: number
}

const matchModeLabel: Record<MatchMode, string> = {
	and: 'All',
	or: 'Any',
}

export const FilterControls: React.FC<FilterControlsProps> = ({
	filterText,
	onFilterTextChange,
	onSubmit,
	matchMode,
	onMatchModeChange,
	selectedTags,
	onTagsSubmit,
	disabled = false,
	filters,
	filteredPostCount,
}) => {
	const labelRef = useRef<HTMLLabelElement | null>(null)
	const previousFilteredPostCount = useRef<number | null>(null)
	const filterInputId = useId()

	useEffect(() => {
		if (previousFilteredPostCount.current === null) {
			previousFilteredPostCount.current = filteredPostCount
			return
		}

		const countChanged = filteredPostCount !== previousFilteredPostCount.current

		previousFilteredPostCount.current = filteredPostCount

		if (filters.length > 0 && countChanged) {
			scrollToElement(labelRef.current)
		}
	}, [filteredPostCount, filters])

	useEffect(() => {
		const inputElement = document.getElementById(filterInputId) as HTMLInputElement
		inputElement?.addEventListener('keyup', (keyboardEvent) => {
			if (keyboardEvent.key === 'Enter') {
				inputElement.blur()
			}
		})
		return () => {
			inputElement?.removeEventListener('keyup', (keyboardEvent) => {
				if (keyboardEvent.key === 'Enter') {
					inputElement.blur()
				}
			})
		}
	}, [filterInputId])

	const onTagFilterOpenChange = async (open: boolean) => {
		if (!open) {
			return
		}
		scrollToElement(labelRef.current)
		// wait for the scroll to complete, as workound for sticky header to stay visible before we open keyboard for tag filter popover
		await new Promise((resolve) => setTimeout(resolve, 300))
	}

	return (
		<form onSubmit={onSubmit}>
			<label className="sr-only" htmlFor={filterInputId} ref={labelRef}>
				Filter posts
			</label>
			<div className="flex items-center gap-2">
				<div className="relative min-w-0 flex-1">
					<Search
						className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<input
						id={filterInputId}
						className="h-9 w-full rounded-full border border-input bg-background pl-9 pr-3 text-base transition-colors focus:border-ring focus:outline-hidden focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
						type="text"
						placeholder="Filter posts…"
						value={filterText}
						onChange={(event) => onFilterTextChange(event.target.value)}
						aria-label="Add a filter term for posts"
						disabled={disabled}
					/>
				</div>
				{filterText.trim() && (
					<button
						type="submit"
						className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-[0.98]"
						disabled={disabled}
					>
						Apply
					</button>
				)}
				<TagFilterPopover
					selectedTags={selectedTags}
					onSubmit={onTagsSubmit}
					onOpenChange={onTagFilterOpenChange}
				/>
			</div>

			{filters.length >= 2 && (
				<div className="mt-2 flex items-center gap-2 animate-rise-in">
					<button
						type="button"
						onClick={() => onMatchModeChange(matchMode === 'and' ? 'or' : 'and')}
						tabIndex={-1}
						className="text-xs font-medium tracking-wide text-muted-foreground transition-colors hover:text-foreground active:text-foreground"
						aria-label={`Toggle match mode (currently ${
							matchMode === 'and' ? 'match all' : 'match any'
						})`}
						disabled={disabled}
					>
						Match on
					</button>
					<div className="flex items-center gap-1" role="radiogroup" aria-label="Filter match mode">
						{(['and', 'or'] as const).map((mode) => (
							<label
								key={mode}
								className={cn(
									'inline-flex cursor-pointer items-center rounded-full px-3 py-0.5 text-xs font-medium ring-offset-background transition-colors focus-within:outline-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
									matchMode === mode
										? 'bg-primary text-primary-foreground hover:bg-primary/90'
										: 'bg-muted text-muted-foreground hover:bg-muted/70',
									disabled && 'pointer-events-none opacity-60'
								)}
							>
								<input
									type="radio"
									value={mode}
									checked={matchMode === mode}
									onChange={() => onMatchModeChange(mode)}
									className="sr-only"
									disabled={disabled}
								/>
								<span>{matchModeLabel[mode]}</span>
							</label>
						))}
					</div>
				</div>
			)}
		</form>
	)
}
