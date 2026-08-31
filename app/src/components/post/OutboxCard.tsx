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
import { useOutbox } from '@/hooks/useOutbox'
import { flushEntry, getOutboxSnapshot, removeEntry, retryEntry, type SyncMode } from '@/lib/outbox'
import { requestComposerLoad } from '@/lib/composerBridge'
import type { OutboxEntry } from '@/lib/utils/outboxDb'
import { formatShortTime } from '@/lib/utils/time'
import { identityGradient } from '@/lib/utils/identity'
import { cn } from '@/lib/utils'

interface OutboxCardProps {
	entry: OutboxEntry
}

const statusLabel = (entry: OutboxEntry, syncMode: SyncMode) => {
	if (entry.status === 'sending') return 'Posting…'
	if (entry.status === 'failed') return "Couldn't post"
	if (entry.status === 'published') return 'Posted'
	return syncMode === 'local' ? 'On this device' : 'Queued'
}

export const OutboxCard = ({ entry }: OutboxCardProps) => {
	const { isAuthenticated, username, avatar } = useAuth()
	const { syncMode } = useOutbox()
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
		if (result === 'failed') {
			toast.error("Couldn't remove this post from this device. Try again.")
			return
		}
		toast(entry.status === 'published' ? 'Local copy cleared.' : 'Removed.')
	}

	const handlePostNow = () => {
		if (!navigator.onLine) {
			toast("You're offline.")
			return
		}
		void flushEntry(entry.id)
	}

	const handleEdit = async () => {
		// Re-read at click time: the rendered entry can predate a pass that has
		// since picked it up, and loading a sending entry would put its content in
		// the composer while the send still publishes it. No await sits between
		// this check and removeEntry's own, so the two cannot disagree.
		const current = getOutboxSnapshot().entries.find((candidate) => candidate.id === entry.id)
		if (!current) return
		if (current.status === 'sending') {
			toast("This post is already being sent, so it can't be edited.")
			return
		}
		const composerLoad = requestComposerLoad(current)
		if (!composerLoad) {
			toast('Finish or clear the composer first.')
			return
		}
		const result = await removeEntry(entry.id)
		if (result === 'sending') {
			composerLoad.rollback()
			toast("This post started sending, so it can't be edited.")
			return
		}
		if (result === 'failed') {
			composerLoad.rollback()
			toast.error("Couldn't remove the stored copy. The post is still in your outbox.")
			return
		}
		composerLoad.commit()
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
						(entry.status === 'failed' || entry.status === 'published') &&
							'border-destructive/30 bg-destructive/10 text-destructive'
					)}
				>
					{entry.status === 'sending' && <Loader2 className="h-3 w-3 animate-spin" />}
					{statusLabel(entry, syncMode)}
				</span>
				{entry.isDraft && (
					<span className="rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">
						Draft
					</span>
				)}
			</div>

			{(entry.status === 'failed' || entry.status === 'published') && entry.lastError && (
				<p className="mt-2 text-sm text-destructive">{entry.lastError}</p>
			)}

			<div className="mt-2 flex justify-end gap-1">
				{entry.status === 'queued' && (
					<Button type="button" variant="ghost" size="sm" onClick={handlePostNow}>
						Post now
					</Button>
				)}
				{(entry.status === 'queued' || entry.status === 'failed') && (
					<Button type="button" variant="ghost" size="sm" onClick={() => void handleEdit()}>
						Edit
					</Button>
				)}
				{entry.status === 'failed' && (
					<Button type="button" variant="ghost" size="sm" onClick={() => void retryEntry(entry.id)}>
						Retry
					</Button>
				)}
				<Button type="button" variant="ghost" size="sm" onClick={() => setRemoveOpen(true)}>
					{entry.status === 'published' ? 'Clear' : 'Remove'}
				</Button>
			</div>

			<AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{entry.status === 'published' ? 'Clear local copy?' : 'Remove queued post?'}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{entry.status === 'published'
								? 'The post is already published. This only clears its leftover copy from this device.'
								: "It hasn't been posted and will be gone from this device."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => void handleRemove()}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{entry.status === 'published' ? 'Clear' : 'Remove'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</article>
	)
}
