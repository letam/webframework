import { useState } from 'react'
import { format } from 'date-fns'
import { Play } from 'lucide-react'
import type { LinkPreview } from '@/types/post'

const X_LOGO_PATH =
	'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'

const HN_LOGO_PATH =
	'M0 24V0h24v24H0zM6.951 5.896l4.112 7.708v5.064h1.583v-4.972l4.148-7.799h-1.749l-2.457 4.875c-.372.745-.688 1.434-.688 1.434s-.297-.708-.651-1.434L8.831 5.896h-1.88z'

const REDDIT_LOGO_PATH =
	'M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z'

const OPENAI_LOGO_PATH =
	'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'

const hostname = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}

// Build the date locally from the ISO parts; new Date('2006-03-21') is UTC
// midnight and would render as the previous day west of Greenwich.
const formatPublishedDate = (iso: string | null) => {
	if (!iso) {
		return ''
	}
	const [year, month, day] = iso.split('-').map(Number)
	if (!year || !month || !day) {
		return ''
	}
	return format(new Date(year, month - 1, day), 'MMM d, yyyy')
}

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

const YouTubeCard = ({ preview }: { preview: LinkPreview }) => {
	const [playing, setPlaying] = useState(false)
	const meta = [preview.author_name, 'YouTube', formatPublishedDate(preview.published_at)]
		.filter(Boolean)
		.join(' · ')

	return (
		<div data-testid="link-preview-youtube" className="overflow-hidden rounded-md border">
			<div className="relative aspect-video bg-black">
				{playing ? (
					<iframe
						src={`https://www.youtube-nocookie.com/embed/${preview.embed_id}?autoplay=1`}
						className="h-full w-full"
						allow="autoplay; encrypted-media; picture-in-picture"
						allowFullScreen
						// YouTube requires a referrer from embedding sites (player error 153),
						// and the document-level policy of same-origin sends none cross-origin.
						referrerPolicy="strict-origin-when-cross-origin"
						title={preview.title}
					/>
				) : (
					<button
						type="button"
						className="relative h-full w-full bg-black"
						onClick={() => setPlaying(true)}
						aria-label="Play video"
					>
						{preview.image && (
							<img
								src={preview.image}
								className="h-full w-full object-cover"
								loading="lazy"
								alt={preview.title}
							/>
						)}
						<span className="absolute top-1/2 left-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary/80 text-primary-foreground">
							<Play className="h-6 w-6 fill-current" />
						</span>
					</button>
				)}
			</div>
			<a href={preview.url} target="_blank" rel="noopener noreferrer" className="block p-3">
				<div className="line-clamp-2 text-sm font-medium leading-snug">{preview.title}</div>
				<div className="mt-1 truncate text-[13px] text-muted-foreground">{meta}</div>
				{preview.description && (
					<div className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
						{preview.description}
					</div>
				)}
			</a>
		</div>
	)
}

const TwitterCard = ({ preview }: { preview: LinkPreview }) => (
	<a
		href={preview.url}
		target="_blank"
		rel="noopener noreferrer"
		data-testid="link-preview-twitter"
		className="block rounded-md border p-3 transition-colors hover:border-primary/20 hover:bg-accent/30"
	>
		<div className="flex min-w-0 items-center gap-2">
			<svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
				<path d={X_LOGO_PATH} />
			</svg>
			<div className="truncate text-sm font-medium">{preview.author_name}</div>
			{preview.author_handle && (
				<div className="truncate text-[13px] text-muted-foreground">@{preview.author_handle}</div>
			)}
		</div>
		<div className="mt-2 line-clamp-6 whitespace-pre-line text-sm leading-relaxed">
			{preview.description}
		</div>
		{preview.published_at && (
			<div className="mt-2 text-[13px] text-muted-foreground">
				{formatPublishedDate(preview.published_at)}
			</div>
		)}
	</a>
)

const HackerNewsCard = ({ preview }: { preview: LinkPreview }) => {
	const meta = preview.extra.is_comment
		? [
				preview.author_name ? `Comment by ${preview.author_name}` : 'Comment',
				formatPublishedDate(preview.published_at),
			]
		: [
				count(preview.extra.score ?? 0, 'point'),
				count(preview.extra.comments ?? 0, 'comment'),
				preview.author_name && `by ${preview.author_name}`,
				formatPublishedDate(preview.published_at),
			]

	return (
		<a
			href={preview.url}
			target="_blank"
			rel="noopener noreferrer"
			data-testid="link-preview-hackernews"
			className="block rounded-md border p-3 transition-colors hover:border-primary/20 hover:bg-accent/30"
		>
			<div className="flex min-w-0 items-center gap-2">
				<svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-[#ff6600]" aria-hidden="true">
					<path d={HN_LOGO_PATH} />
				</svg>
				<div className="text-sm font-medium">Hacker News</div>
				{preview.extra.domain && (
					<div className="truncate text-[13px] text-muted-foreground">{preview.extra.domain}</div>
				)}
			</div>
			{preview.title && (
				<div className="mt-2 line-clamp-2 text-sm font-medium leading-snug">{preview.title}</div>
			)}
			{preview.description && (
				<div className="mt-1 line-clamp-3 text-[13px] text-muted-foreground">
					{preview.description}
				</div>
			)}
			<div className="mt-2 truncate text-[13px] text-muted-foreground">
				{meta.filter(Boolean).join(' · ')}
			</div>
		</a>
	)
}

const RedditCard = ({ preview }: { preview: LinkPreview }) => {
	const subreddit = preview.extra.subreddit

	return (
		<a
			href={preview.url}
			target="_blank"
			rel="noopener noreferrer"
			data-testid="link-preview-reddit"
			className="block rounded-md border p-3 transition-colors hover:border-primary/20 hover:bg-accent/30"
		>
			<div className="flex min-w-0 items-center gap-2">
				<svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden="true">
					<path d={REDDIT_LOGO_PATH} />
				</svg>
				<div className="text-sm font-medium">{subreddit ? `r/${subreddit}` : 'Reddit'}</div>
				{subreddit && <div className="truncate text-[13px] text-muted-foreground">Reddit</div>}
			</div>
			<div className="mt-2 line-clamp-2 text-sm font-medium leading-snug">{preview.title}</div>
			{preview.author_name && (
				<div className="mt-2 truncate text-[13px] text-muted-foreground">
					u/{preview.author_name}
				</div>
			)}
		</a>
	)
}

const ChatGPTCard = ({ preview }: { preview: LinkPreview }) => (
	<a
		href={preview.url}
		target="_blank"
		rel="noopener noreferrer"
		data-testid="link-preview-chatgpt"
		className="block rounded-md border p-3 transition-colors hover:border-primary/20 hover:bg-accent/30"
	>
		<div className="flex min-w-0 items-center gap-2">
			<svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden="true">
				<path d={OPENAI_LOGO_PATH} />
			</svg>
			<div className="text-sm font-medium">ChatGPT</div>
		</div>
		<div className="mt-2 line-clamp-2 text-sm font-medium leading-snug">{preview.title}</div>
		<div className="mt-2 truncate text-[13px] text-muted-foreground">
			{['Shared conversation', formatPublishedDate(preview.published_at)]
				.filter(Boolean)
				.join(' · ')}
		</div>
	</a>
)

const GenericCard = ({ preview }: { preview: LinkPreview }) => (
	<a
		href={preview.url}
		target="_blank"
		rel="noopener noreferrer"
		data-testid="link-preview-generic"
		className="flex overflow-hidden rounded-md border transition-colors hover:border-primary/20 hover:bg-accent/30"
	>
		<div className="min-w-0 flex-1 p-3">
			<div className="truncate text-[13px] text-muted-foreground">
				{[preview.site_name || hostname(preview.url), formatPublishedDate(preview.published_at)]
					.filter(Boolean)
					.join(' · ')}
			</div>
			<div className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug">{preview.title}</div>
			{preview.description && (
				<div className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
					{preview.description}
				</div>
			)}
		</div>
		{preview.image && (
			<div className="relative min-h-[88px] w-[88px] shrink-0 border-l">
				<img
					className="absolute inset-0 h-full w-full object-cover"
					src={preview.image}
					loading="lazy"
					alt=""
				/>
			</div>
		)}
	</a>
)

export default function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
	if (preview.kind === 'youtube') {
		return <YouTubeCard preview={preview} />
	}
	if (preview.kind === 'twitter') {
		return <TwitterCard preview={preview} />
	}
	if (preview.kind === 'hackernews') {
		return <HackerNewsCard preview={preview} />
	}
	if (preview.kind === 'reddit') {
		return <RedditCard preview={preview} />
	}
	if (preview.kind === 'chatgpt') {
		return <ChatGPTCard preview={preview} />
	}
	return <GenericCard preview={preview} />
}
