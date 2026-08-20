import { useOutbox } from '@/hooks/useOutbox'
import { OutboxCard } from '@/components/post/OutboxCard'

export const OutboxList = () => {
	const { entries } = useOutbox()
	if (entries.length === 0) return null

	return (
		<div className="mx-auto my-4 max-w-lg space-y-3" data-testid="outbox-list">
			{[...entries]
				.sort((a, b) => b.createdAt - a.createdAt)
				.map((entry) => (
					<OutboxCard key={entry.id} entry={entry} />
				))}
		</div>
	)
}
