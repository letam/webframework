import { useState } from 'react'
import { Play } from 'lucide-react'
import type { LinkPreview } from '@/types/post'

const X_LOGO_PATH =
	'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'

const hostname = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}

const YouTubeCard = ({ preview }: { preview: LinkPreview }) => {
	const [playing, setPlaying] = useState(false)
	const meta = preview.author_name ? `${preview.author_name} · YouTube` : 'YouTube'

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
				{preview.site_name || hostname(preview.url)}
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
	return <GenericCard preview={preview} />
}
