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
		<div className="mt-1 space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
					Active filters{' '}
					<button
						type="button"
						onClick={onClearFilters}
						className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
					>
						Clear all
					</button>
				</span>
				{filters.map((filter) => (
					<div key={filter.token} className="relative inline-flex">
						<button
							type="button"
							onClick={() => onToggleFilter(filter.token)}
							className={cn(
								'inline-flex items-center rounded-full border px-2.5 py-1 pr-6 font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
								filter.enabled
									? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
									: 'border-border bg-secondary text-muted-foreground hover:text-foreground'
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
								'absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full text-xs leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
								filter.enabled
									? 'text-primary/60 hover:bg-primary/10 hover:text-primary'
									: 'text-muted-foreground/60 hover:bg-muted hover:text-foreground'
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
