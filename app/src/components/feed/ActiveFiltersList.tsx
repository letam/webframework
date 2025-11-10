import type React from 'react'
import { cn } from '@/lib/utils'
import type { FilterToken } from '@/hooks/usePostFilters'

type ActiveFiltersListProps = {
	filters: FilterToken[]
	onToggleFilter: (token: string) => void
	onRemoveFilter: (token: string) => void
	onClearFilters: () => void
}

export const ActiveFiltersList: React.FC<ActiveFiltersListProps> = ({
	filters,
	onToggleFilter,
	onRemoveFilter,
	onClearFilters,
}) => {
	if (filters.length === 0) {
		return null
	}

	return (
		<div className="space-y-3 mt-1">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm font-medium text-muted-foreground">
					Active filters{' '}
					<button
						type="button"
						onClick={onClearFilters}
						className="text-sm font-medium text-primary hover:underline"
					>
						(Clear all)
					</button>
					:
				</span>
				{filters.map((filter) => (
					<div
						key={filter.token}
						className="relative inline-flex text-sm text-secondary-foreground"
					>
						<button
							type="button"
							onClick={() => onToggleFilter(filter.token)}
							className={cn(
								'inline-flex items-center rounded-full px-3 py-1 pr-7 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
								filter.enabled
									? 'bg-primary text-primary-foreground hover:bg-primary/90'
									: 'bg-muted text-muted-foreground hover:bg-muted/70'
							)}
							aria-label={`${filter.enabled ? 'Disable' : 'Enable'} filter ${filter.token}`}
						>
							<span>{filter.token}</span>
						</button>
						<button
							type="button"
							onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
								event.stopPropagation()
								onRemoveFilter(filter.token)
							}}
							className={cn(
								'absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-base leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
								filter.enabled
									? 'text-primary-foreground hover:bg-primary-foreground/80 hover:text-primary'
									: 'text-muted-foreground hover:bg-muted-foreground hover:text-background'
							)}
							aria-label={`Remove filter ${filter.token}`}
						>
							<span aria-hidden="true">&times;</span>
						</button>
					</div>
				))}
			</div>
		</div>
	)
}
