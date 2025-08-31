import { useState } from 'react'
import { X, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getMediaUrl } from '@/lib/api/posts'
import type { Post } from '../types/post'

interface ImageModalProps {
	post: Post
	isOpen: boolean
	onClose: () => void
}

export const ImageModal: React.FC<ImageModalProps> = ({ post, isOpen, onClose }) => {
	const [isLoadingFullRes, setIsLoadingFullRes] = useState(false)
	const [fullResUrl, setFullResUrl] = useState<string | null>(null)

	if (!isOpen || !post.media) {
		return null
	}

	const handleLoadFullResolution = async () => {
		setIsLoadingFullRes(true)
		try {
			const url = getMediaUrl(post)
			setFullResUrl(url)
		} catch (error) {
			console.error('Error loading full resolution image:', error)
		} finally {
			setIsLoadingFullRes(false)
		}
	}

	const handleDownload = () => {
		if (fullResUrl) {
			const link = document.createElement('a')
			link.href = fullResUrl
			link.download = `post-${post.id}-full-resolution.jpg`
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link)
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === 'Escape') {
					onClose()
				}
			}}
			tabIndex={-1}
			role="dialog"
			aria-modal="true"
		>
			<div className="relative max-w-[90vw] max-h-[90vh] bg-white rounded-lg overflow-hidden">
				{/* Header */}
				<div className="flex items-center justify-between p-4 border-b">
					<div className="flex items-center gap-2">
						<h3 className="text-lg font-semibold">{post.head || 'Image'}</h3>
						{post.media.alt_text && (
							<span className="text-sm text-muted-foreground">- {post.media.alt_text}</span>
						)}
					</div>
					<Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
						<X className="h-4 w-4" />
					</Button>
				</div>

				{/* Image Container */}
				<div className="relative flex items-center justify-center min-h-[400px] max-h-[70vh] bg-gray-50">
					{fullResUrl ? (
						<img
							src={fullResUrl}
							alt={post.media.alt_text || 'Full resolution image'}
							className="max-w-full max-h-full object-contain"
						/>
					) : (
						<div className="text-center">
							<p className="text-muted-foreground mb-4">
								Compressed version loaded. Click below to view full resolution.
							</p>
							<Button
								onClick={handleLoadFullResolution}
								disabled={isLoadingFullRes}
								className="flex items-center gap-2"
							>
								{isLoadingFullRes && <Loader2 className="h-4 w-4 animate-spin" />}
								{isLoadingFullRes ? 'Loading...' : 'Load Full Resolution'}
							</Button>
						</div>
					)}
				</div>

				{/* Footer */}
				{fullResUrl && (
					<div className="flex items-center justify-between p-4 border-t">
						<div className="text-sm text-muted-foreground">Full resolution image loaded</div>
						<Button
							onClick={handleDownload}
							variant="outline"
							size="sm"
							className="flex items-center gap-2"
						>
							<Download className="h-4 w-4" />
							Download
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
