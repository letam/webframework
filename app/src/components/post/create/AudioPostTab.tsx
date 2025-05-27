import type React from 'react'
import { useRef } from 'react'
import { FileAudio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AudioRecorder from './AudioRecorder'

interface AudioPostTabProps {
	onAudioCaptured: (blob: Blob) => void
	onAudioFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
	onSubmit: (e: React.MouseEvent) => void
	disabled?: boolean
}

const AudioPostTab: React.FC<AudioPostTabProps> = ({
	onAudioCaptured,
	onAudioFileChange,
	onSubmit,
	disabled,
}) => {
	const audioInputRef = useRef<HTMLInputElement>(null)

	const openAudioFileSelector = () => {
		if (audioInputRef.current) {
			audioInputRef.current.click()
		}
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3">
				<AudioRecorder onAudioCaptured={onAudioCaptured} disabled={disabled} />

				<div className="flex items-center space-x-2">
					<Button
						type="button"
						variant="outline"
						onClick={openAudioFileSelector}
						className="text-xs"
						size="sm"
						disabled={disabled}
					>
						<FileAudio className="h-4 w-4 mr-2" />
						Upload Audio File
					</Button>
					<input
						type="file"
						ref={audioInputRef}
						className="hidden"
						accept="audio/*"
						onChange={onAudioFileChange}
						disabled={disabled}
					/>
				</div>
			</div>

			<div className="flex justify-end">
				<Button type="button" onClick={onSubmit} disabled={disabled}>
					Post
				</Button>
			</div>
		</div>
	)
}

export default AudioPostTab
