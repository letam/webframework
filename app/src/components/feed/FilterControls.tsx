import type React from 'react'
import { cn } from '@/lib/utils'
import { TagFilterPopover } from './TagFilterPopover'
import type { FilterToken, MatchMode } from '@/hooks/usePostFilters'
import { useEffect, useRef } from 'react'
import { scrollToElement } from '@/lib/utils/ui'

type FilterControlsProps = {
	filterInputId: string
	matchModeFieldName: string
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
	filterInputId,
	matchModeFieldName,
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
			<label
				className="block text-sm font-medium text-muted-foreground mb-2"
				htmlFor={filterInputId}
				ref={labelRef}
			>
				Filter posts
			</label>
			<div className="flex flex-wrap items-center gap-2">
				<input
					id={filterInputId}
					className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
					type="text"
					placeholder="Enter words to filter posts…"
					value={filterText}
					onChange={(event) => onFilterTextChange(event.target.value)}
					aria-label="Add a filter term for posts"
					disabled={disabled}
				/>
				<button
					type="submit"
					className="inline-flex min-w-[96px] items-center justify-center rounded-md bg-primary px-5 py-2 text-base font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:px-3 sm:text-sm"
					disabled={disabled}
				>
					Apply
				</button>

				<div className="flex w-full flex-row items-center gap-2">
					<div className="flex items-center gap-2 rounded-md px-3 py-2 sm:bg-background/80 sm:px-2 sm:py-1">
						<button
							type="button"
							onClick={() => onMatchModeChange(matchMode === 'and' ? 'or' : 'and')}
							tabIndex={-1}
							className="text-xs font-medium tracking-wide text-muted-foreground transition-colors hover:text-foreground active:text-foreground sm:text-sm"
							aria-label={`Toggle match mode (currently ${
								matchMode === 'and' ? 'match all' : 'match any'
							})`}
							disabled={disabled}
						>
							Match on
						</button>
						<div
							className="flex items-center gap-1"
							role="radiogroup"
							aria-label="Filter match mode"
						>
							{(['and', 'or'] as const).map((mode) => (
								<label
									key={mode}
									className={cn(
										'inline-flex cursor-pointer items-center rounded-full px-3 py-1 text-xs sm:text-sm font-medium transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
										matchMode === mode
											? 'bg-primary text-primary-foreground hover:bg-primary/90'
											: 'bg-muted text-muted-foreground hover:bg-muted/70',
										disabled && 'pointer-events-none opacity-60'
									)}
								>
									<input
										type="radio"
										name={matchModeFieldName}
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
					<TagFilterPopover
						selectedTags={selectedTags}
						onSubmit={onTagsSubmit}
						onOpenChange={onTagFilterOpenChange}
					/>
				</div>
			</div>
		</form>
	)
}
