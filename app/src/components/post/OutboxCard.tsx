import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/sonner'
import { useAuth } from '@/hooks/useAuth'
import { removeEntry, retryEntry } from '@/lib/outbox'
import type { OutboxEntry } from '@/lib/utils/outboxDb'
import { formatShortTime } from '@/lib/utils/time'
import { identityGradient } from '@/lib/utils/identity'
import { cn } from '@/lib/utils'

interface OutboxCardProps {
	entry: OutboxEntry
}

const statusLabel = (entry: OutboxEntry) => {
	if (entry.status === 'sending') return 'Posting…'
	if (entry.status === 'failed') return "Couldn't post"
	return 'Queued'
}

export const OutboxCard = ({ entry }: OutboxCardProps) => {
	const { isAuthenticated, username, avatar } = useAuth()
	const [removeOpen, setRemoveOpen] = useState(false)
	const [mediaUrl, setMediaUrl] = useState<string | null>(null)
	const identity = isAuthenticated ? (username ?? 'you') : 'anonymous'
	const authorLabel = isAuthenticated ? `@${username ?? 'you'}` : '@anonymous'

	useEffect(() => {
		if (!entry.media) {
			setMediaUrl(null)
			return
		}

		const url = URL.createObjectURL(entry.media)
		setMediaUrl(url)
		return () => URL.revokeObjectURL(url)
	}, [entry.media])

	const handleRemove = async () => {
		const result = await removeEntry(entry.id)
		setRemoveOpen(false)
		if (result === 'sending') {
			toast("This post is already being sent, so it can't be removed.")
			return
		}
		toast('Removed.')
	}

	return (
		<article
			className="animate-rise-in rounded-lg border bg-card/80 px-4 py-3 text-foreground shadow-xs"
			data-testid={`outbox-${entry.id}`}
		>
			<div className="flex items-start gap-2">
				<Avatar className="h-10 w-10 opacity-80">
					<AvatarImage src={isAuthenticated ? (avatar ?? undefined) : undefined} alt={identity} />
					<AvatarFallback className="text-white" style={{ background: identityGradient(identity) }}>
						{identity[0]?.toUpperCase()}
					</AvatarFallback>
				</Avatar>

				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
						<span className="text-[15px] font-semibold leading-tight">{authorLabel}</span>
						<span className="text-[13px] text-muted-foreground">
							{formatShortTime(entry.createdAt)}
						</span>
					</div>
				</div>
			</div>

			{entry.text && (
				<p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
					{entry.text}
				</p>
			)}

			{entry.media && entry.mediaType && mediaUrl && (
				<div className="mt-3 w-full" data-testid="outbox-media-preview">
					{entry.mediaType === 'image' && (
						<img
							src={mediaUrl}
							alt={entry.mediaName ? `Queued attachment: ${entry.mediaName}` : 'Queued attachment'}
							className="max-h-64 w-full rounded-md bg-black object-contain"
						/>
					)}
					{entry.mediaType === 'audio' && (
						<audio src={mediaUrl} controls className="w-full">
							<track kind="captions" label="English" />
						</audio>
					)}
					{entry.mediaType === 'video' && (
						<video src={mediaUrl} controls className="max-h-64 w-full rounded-md bg-black">
							<track kind="captions" label="English" />
						</video>
					)}
				</div>
			)}

			<div className="mt-2 flex flex-wrap items-center gap-1.5">
				<span
					className={cn(
						'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground',
						entry.status === 'failed' && 'border-destructive/30 bg-destructive/10 text-destructive'
					)}
				>
					{entry.status === 'sending' && <Loader2 className="h-3 w-3 animate-spin" />}
					{statusLabel(entry)}
				</span>
				{entry.isDraft && (
					<span className="rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">
						Draft
					</span>
				)}
			</div>

			{entry.status === 'failed' && entry.lastError && (
				<p className="mt-2 text-sm text-destructive">{entry.lastError}</p>
			)}

			<div className="mt-2 flex justify-end gap-1">
				{entry.status === 'failed' && (
					<Button type="button" variant="ghost" size="sm" onClick={() => void retryEntry(entry.id)}>
						Retry
					</Button>
				)}
				<Button type="button" variant="ghost" size="sm" onClick={() => setRemoveOpen(true)}>
					Remove
				</Button>
			</div>

			<AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove queued post?</AlertDialogTitle>
						<AlertDialogDescription>
							It hasn't been posted and will be gone from this device.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => void handleRemove()}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</article>
	)
}
