import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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

export const TagFilterPopover: React.FC<TagFilterPopoverProps> = ({ selectedTags, onSubmit }) => {
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

	const handleClearAll = useCallback(() => {
		setPendingTags([])
	}, [])

	const canSubmit = useMemo(() => hasChanges && !isLoadingTags, [hasChanges, isLoadingTags])

	const handleSubmit = useCallback(() => {
		if (!canSubmit) {
			return
		}

		onSubmit(pendingTags.map((tag) => `#${tag}`))
		setIsOpen(false)
	}, [canSubmit, onSubmit, pendingTags])

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
				event.preventDefault()
				handleSubmit()
			}
		},
		[handleSubmit]
	)

	return (
		<Popover
			open={isOpen}
			onOpenChange={(nextOpen) => {
				setIsOpen(nextOpen)
				if (nextOpen && error) {
					void refetch()
				}
			}}
		>
			<PopoverTrigger asChild>
				<Button type="button" variant="outline" size="sm" className="min-w-[140px]">
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
								<span className="text-xs text-muted-foreground">({selectedTags.length})</span>
							) : null}
						</>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-80" align="end" onKeyDown={handleKeyDown}>
				<div className="space-y-4">
					<div>
						<h3 className="text-sm font-medium text-foreground">Select tags</h3>
						<p className="mt-1 text-xs text-muted-foreground">
							Add hashtags to filter posts. Changes apply after you submit.
						</p>
					</div>
					{error ? (
						<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
							Unable to load tags. Try again.
						</div>
					) : null}
					<Command>
						<CommandInput placeholder="Search tags…" autoFocus />
						<CommandList>
							<CommandEmpty>No matching tags found.</CommandEmpty>
							{isLoadingTags ? (
								<div className="py-6 text-center text-sm text-muted-foreground">Loading tags…</div>
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
												<Check className={cn('size-4', isSelected ? 'opacity-100' : 'opacity-0')} />
												<span className="truncate">#{tagInfo.tag}</span>
												<span className="ml-auto text-xs text-muted-foreground">
													{tagInfo.count}
												</span>
											</CommandItem>
										)
									})}
								</CommandGroup>
							)}
						</CommandList>
					</Command>
					<div className="flex flex-wrap gap-2">
						{pendingTags.length === 0 ? (
							<span className="text-xs text-muted-foreground">No tags selected yet.</span>
						) : (
							pendingTags.map((tag) => (
								<Badge key={tag} variant="secondary" className="flex items-center gap-1">
									<span>#{tag}</span>
									<button
										type="button"
										onClick={() => handleClearPendingTag(tag)}
										className="rounded-full p-0.5 hover:bg-secondary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										aria-label={`Remove tag ${tag}`}
									>
										<X className="size-3.5" />
									</button>
								</Badge>
							))
						)}
					</div>
					<div className="space-y-2">
						{!isMobile ? (
							<p className="text-xs text-muted-foreground">
								Press Cmd+Enter or Ctrl+Enter to submit your tag filters quickly.
							</p>
						) : null}
						<div className="flex items-center justify-end gap-2">
							<Button
								type="button"
								variant="ghost"
								onClick={handleClearAll}
								disabled={pendingTags.length === 0}
							>
								Clear
							</Button>
							<Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
								Submit
							</Button>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
