import type React from 'react'
import { Button } from '@/components/ui/button'
import { Upload } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import VideoRecorder from './VideoRecorder'

interface VideoPostTabProps {
	onVideoCaptured: (blob: Blob) => void
	onVideoFileChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
	onSubmit: (e: React.MouseEvent) => void
	disabled?: boolean
}

const VideoPostTab: React.FC<VideoPostTabProps> = ({
	onVideoCaptured,
	onVideoFileChange,
	onSubmit,
	disabled,
}) => {
	return (
		<div className="space-y-4">
			<VideoRecorder onVideoCaptured={onVideoCaptured} disabled={disabled} />

			<div className="flex flex-col gap-2">
				<Label htmlFor="video-upload" className="text-sm font-medium cursor-pointer">
					<div className="flex items-center gap-2 p-2 border rounded-md hover:bg-accent/50 transition-colors">
						<Upload size={16} />
						<span>Upload video</span>
					</div>
				</Label>
				<Input
					type="file"
					id="video-upload"
					accept="video/*"
					className="hidden"
					onChange={onVideoFileChange}
					disabled={disabled}
				/>
			</div>

			<div className="flex justify-end">
				<Button type="button" onClick={onSubmit} disabled={disabled}>
					Post
				</Button>
			</div>
		</div>
	)
}

export default VideoPostTab
