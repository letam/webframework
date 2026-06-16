import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/components/ui/command'
import { useTags } from '@/hooks/useTags'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { Check, Loader2, X } from 'lucide-react'

interface TagFilterPopoverProps {
	selectedTags: string[]
	onSubmit: (tags: string[]) => void
	onOpenChange?: (open: boolean) => Promise<void>
}

const normalizeTag = (tag: string) => tag.replace(/^#+/, '').trim()

const uniqueNormalizedTags = (tags: string[]) =>
	Array.from(
		new Map(
			tags
				.map(normalizeTag)
				.filter((tag) => tag.length > 0)
				.map((tag) => [tag.toLowerCase(), tag])
		).values()
	)

export const TagFilterPopover: React.FC<TagFilterPopoverProps> = ({
	selectedTags,
	onSubmit,
	onOpenChange,
}) => {
	const { tags, isLoading, isFetching, error, refetch } = useTags()
	const [isOpen, setIsOpen] = useState(false)
	const [pendingTags, setPendingTags] = useState<string[]>([])
	const isMobile = useIsMobile()

	const normalizedSelectedTags = useMemo(
		() => uniqueNormalizedTags(selectedTags ?? []),
		[selectedTags]
	)

	const isLoadingTags = isLoading || isFetching
	const pendingTagSet = useMemo(
		() => new Set(pendingTags.map((tag) => tag.toLowerCase())),
		[pendingTags]
	)

	useEffect(() => {
		if (!isOpen) {
			return
		}

		setPendingTags(normalizedSelectedTags)
	}, [isOpen, normalizedSelectedTags])

	const hasChanges = useMemo(() => {
		if (pendingTags.length !== normalizedSelectedTags.length) {
			return true
		}

		const selectedSet = new Set(normalizedSelectedTags.map((tag) => tag.toLowerCase()))
		return pendingTags.some((tag) => !selectedSet.has(tag.toLowerCase()))
	}, [pendingTags, normalizedSelectedTags])

	const handleTogglePendingTag = useCallback((tag: string) => {
		const normalized = normalizeTag(tag)

		if (!normalized) {
			return
		}

		setPendingTags((prev) => {
			const index = prev.findIndex(
				(existing) => existing.toLowerCase() === normalized.toLowerCase()
			)

			if (index >= 0) {
				return prev.filter((_, i) => i !== index)
			}

			return [...prev, normalized]
		})
	}, [])

	const handleClearPendingTag = useCallback((tag: string) => {
		setPendingTags((prev) =>
			prev.filter((existingTag) => existingTag.toLowerCase() !== tag.toLowerCase())
		)
	}, [])

	const handleSubmit = useCallback(() => {
		if (pendingTags.length === 0 && !hasChanges) {
			setIsOpen(false)
			return
		}

		onSubmit(pendingTags.map((tag) => `#${tag}`))
		setIsOpen(false)
	}, [hasChanges, onSubmit, pendingTags])

	const handleClearAll = useCallback(() => {
		setPendingTags([])
		onSubmit([])
		setIsOpen(false)
	}, [onSubmit])

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
				event.preventDefault()
				handleSubmit()
			}
		},
		[handleSubmit]
	)

	const selectedTagBadgesContent =
		pendingTags.length === 0 ? (
			<span className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-muted-foreground">
				No tags selected yet.
			</span>
		) : (
			pendingTags.map((tag) => (
				<span
					key={tag}
					className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-mono text-xs text-primary"
				>
					<span>#{tag}</span>
					<button
						type="button"
						onClick={() => handleClearPendingTag(tag)}
						className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-primary/60 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label={`Remove tag ${tag}`}
					>
						<X className="size-3" />
					</button>
				</span>
			))
		)

	return (
		<Popover
			open={isOpen}
			onOpenChange={(nextOpen) => {
				;(async () => {
					await onOpenChange?.(nextOpen)
					setIsOpen(nextOpen)
					if (nextOpen) {
						if (error) {
							void refetch()
						}
					}
				})()
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="min-w-[140px] rounded-md border border-border bg-secondary font-mono text-[0.7rem] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-secondary hover:text-foreground"
				>
					{error ? (
						<>
							<X className="size-4 text-destructive" />
							Retry tags
						</>
					) : isLoadingTags ? (
						<>
							<Loader2 className="size-4 animate-spin" />
							Loading tags
						</>
					) : (
						<>
							<span>Filter by Tags</span>
							{selectedTags.length > 0 ? (
								<span className="font-mono text-[0.65rem] text-primary">
									({selectedTags.length})
								</span>
							) : null}
						</>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className={cn('w-80', !isMobile && 'w-[640px]')}
				align={isMobile ? 'end' : 'center'}
				sideOffset={8}
				onKeyDown={handleKeyDown}
			>
				<div className="flex flex-col gap-4">
					<div className="flex items-start justify-between gap-2">
						<div>
							<h3 className="font-display text-sm font-medium text-foreground">Select tags</h3>
							<p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
								Add hashtags to filter posts. Changes apply after you submit.
							</p>
						</div>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="rounded-md p-1 text-muted-foreground transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-label="Close tag filter"
						>
							<X className="size-4" />
						</button>
					</div>
					{error ? (
						<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
							Unable to load tags. Try again.
						</div>
					) : null}
					<div className={cn('space-y-4', !isMobile && 'flex gap-4 space-y-0')}>
						<Command className={cn(!isMobile && 'flex-1')}>
							<CommandInput placeholder="Search tags…" autoFocus enableClearButton />
							<CommandList
								className={cn('max-h-[180px] overflow-y-auto', !isMobile && 'max-h-[240px]')}
							>
								<CommandEmpty>No matching tags found.</CommandEmpty>
								{isLoadingTags ? (
									<div className="py-6 text-center text-sm text-muted-foreground">
										Loading tags…
									</div>
								) : tags.length === 0 ? (
									<div className="py-6 text-center text-sm text-muted-foreground">
										No tags available yet.
									</div>
								) : (
									<CommandGroup>
										{tags.map((tagInfo) => {
											const isSelected = pendingTagSet.has(tagInfo.tag.toLowerCase())
											return (
												<CommandItem
													key={tagInfo.tag}
													value={tagInfo.tag}
													keywords={[`#${tagInfo.tag}`]}
													onSelect={(value) => handleTogglePendingTag(value)}
													className="flex items-center gap-2"
												>
													<Check
														className={cn('size-4', isSelected ? 'opacity-100' : 'opacity-0')}
													/>
													<span className="truncate">#{tagInfo.tag}</span>
													<span className="ml-auto font-mono text-[0.65rem] tabular-nums text-muted-foreground">
														{tagInfo.count}
													</span>
												</CommandItem>
											)
										})}
									</CommandGroup>
								)}
							</CommandList>
						</Command>
						{!isMobile ? (
							<div className="flex w-[240px] flex-col gap-3 rounded-md border border-border/60 bg-muted/10 p-3">
								<div className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
									Selected tags
								</div>
								<div className="flex max-h-[240px] flex-wrap content-start gap-2 overflow-y-auto pr-1">
									{selectedTagBadgesContent}
								</div>
							</div>
						) : null}
					</div>
					{isMobile ? <div className="flex flex-wrap gap-2">{selectedTagBadgesContent}</div> : null}
					<div className="space-y-2">
						{!isMobile ? (
							<p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
								Press Cmd+Enter or Ctrl+Enter to submit your tag filters quickly.
							</p>
						) : null}
						<div className="flex items-center justify-between gap-2">
							<Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
								Cancel
							</Button>
							<div className="flex items-center gap-2">
								<Button type="button" variant="ghost" onClick={handleClearAll}>
									Clear
								</Button>
								<Button type="button" onClick={handleSubmit}>
									Submit
								</Button>
							</div>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
