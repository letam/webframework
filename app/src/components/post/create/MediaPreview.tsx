import type React from 'react'
import { X, FileAudio, FileVideo, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MediaPreviewProps {
	mediaType: 'audio' | 'video' | 'text'
	audioBlob: Blob | null
	audioFile: File | null
	videoBlob: Blob | null
	videoFile: File | null
	onClearMedia: () => void
}

const MediaPreview: React.FC<MediaPreviewProps> = ({
	mediaType,
	audioBlob,
	audioFile,
	videoBlob,
	videoFile,
	onClearMedia,
}) => {
	if (!audioBlob && !audioFile && !videoBlob && !videoFile) {
		return null
	}

	return (
		<div className="relative mb-4 bg-accent/10 rounded-md p-3">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="absolute top-1 right-1 h-6 w-6"
				onClick={onClearMedia}
			>
				<X className="h-4 w-4" />
			</Button>

			{mediaType === 'audio' && (audioBlob || audioFile) && (
				<div className="flex items-center space-x-2 text-sm text-muted-foreground">
					<FileAudio className="h-4 w-4" />
					<span>{audioFile ? audioFile.name : 'Voice recording'}</span>
				</div>
			)}

			{mediaType === 'video' && (videoBlob || videoFile) && (
				<div className="flex items-center space-x-2 text-sm text-muted-foreground">
					{videoFile ? <FileVideo className="h-4 w-4" /> : <Video className="h-4 w-4" />}
					<span>{videoFile ? videoFile.name : 'Video recording'}</span>
				</div>
			)}
		</div>
	)
}

export default MediaPreview
