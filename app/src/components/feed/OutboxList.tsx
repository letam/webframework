import { useOutbox } from '@/hooks/useOutbox'
import { OutboxCard } from '@/components/post/OutboxCard'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { flushOutbox } from '@/lib/outbox'

export const OutboxList = () => {
	const { entries, syncMode } = useOutbox()
	if (entries.length === 0) return null
	const queuedCount = entries.filter((entry) => entry.status === 'queued').length

	const handlePostAll = () => {
		if (!navigator.onLine) {
			toast("You're offline.")
			return
		}
		void flushOutbox({ manual: true })
	}

	return (
		<div className="mx-auto my-4 max-w-lg space-y-3" data-testid="outbox-list">
			{syncMode === 'local' && (
				<div className="flex items-center justify-between px-1">
					<span className="text-sm font-medium text-muted-foreground">
						On this device — {entries.length}
					</span>
					{queuedCount > 0 && (
						<Button type="button" variant="ghost" size="sm" onClick={handlePostAll}>
							Post all
						</Button>
					)}
				</div>
			)}
			{[...entries]
				.sort((a, b) => b.createdAt - a.createdAt)
				.map((entry) => (
					<OutboxCard key={entry.id} entry={entry} />
				))}
		</div>
	)
}
