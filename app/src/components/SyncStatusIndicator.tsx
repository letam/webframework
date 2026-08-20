import { Cloud, HardDrive, Loader2, TriangleAlert, WifiOff } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useOutbox } from '@/hooks/useOutbox'

export const SyncStatusIndicator = () => {
	const online = useOnlineStatus()
	const { entries, flushing, syncMode } = useOutbox()
	const count = entries.length
	const failedCount = entries.filter((entry) => entry.status === 'failed').length

	let label: string
	let Icon = Cloud
	let iconClassName = 'h-4 w-4'
	let visibleCount: number | null = count

	if (!online && count > 0) {
		Icon = WifiOff
		// Local mode must not promise an auto-send that reconnecting won't perform.
		label =
			syncMode === 'local'
				? count === 1
					? "You're offline — 1 post on this device."
					: `You're offline — ${count} posts on this device.`
				: count === 1
					? "You're offline — 1 post queued. It'll go out when you're back online."
					: `You're offline — ${count} posts queued. They'll go out when you're back online.`
	} else if (!online) {
		Icon = WifiOff
		label = "You're offline. New posts will be queued on this device."
		visibleCount = null
	} else if (flushing) {
		Icon = Loader2
		iconClassName = 'h-4 w-4 animate-spin'
		label = 'Sending queued posts…'
	} else if (failedCount > 0) {
		Icon = TriangleAlert
		label = "Some queued posts couldn't be sent."
		visibleCount = failedCount
	} else if (syncMode === 'local' && count > 0) {
		Icon = HardDrive
		label = 'Auto-sync is off — posts stay on this device.'
	} else if (count > 0) {
		label = `${count} queued.`
	} else {
		return null
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<output
					className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground"
					aria-label={label}
				>
					<Icon className={iconClassName} />
					{visibleCount !== null && (
						<span aria-hidden="true" className="tabular-nums">
							{visibleCount}
						</span>
					)}
					{/* <output> is a live region; without this its announcements would be
					    the bare digit. The digit is aria-hidden so only the sentence in
					    here is ever read, including on label-only state changes. */}
					<span className="sr-only">{label}</span>
				</output>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	)
}
