import type React from 'react'
import { useRef, useState, useEffect } from 'react'
import { FileAudio, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AudioRecorder, { type AudioRecorderRef } from './AudioRecorder'

interface AudioPostTabProps {
	onAudioCaptured: (blob: Blob) => void
	onAudioFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
	onSubmit: (e: React.MouseEvent) => void
	disabled?: boolean
	processingStatus?: '' | 'compressing' | 'submitting'
}

const AudioPostTab: React.FC<AudioPostTabProps> = ({
	onAudioCaptured,
	onAudioFileChange,
	onSubmit,
	disabled,
	processingStatus = '',
}) => {
	const audioInputRef = useRef<HTMLInputElement>(null)
	const audioRecorderRef = useRef<AudioRecorderRef>(null)
	const [isWaitingForProcessing, setIsWaitingForProcessing] = useState(false)

	const openAudioFileSelector = () => {
		if (audioInputRef.current) {
			audioInputRef.current.click()
		}
	}

	const handleSubmit = async (e: React.MouseEvent) => {
		if (isWaitingForProcessing) return

		const status = audioRecorderRef.current?.getStatus()
		if (status === 'recording') {
			// Stop recording and wait for processing
			setIsWaitingForProcessing(true)
			audioRecorderRef.current?.stopRecording()
		} else if (status === 'ready') {
			// Recording is already processed, submit immediately
			onSubmit(e)
		}
	}

	// Watch for recording status changes
	useEffect(() => {
		if (!isWaitingForProcessing) return

		const checkStatus = () => {
			const status = audioRecorderRef.current?.getStatus()
			if (status === 'ready') {
				setIsWaitingForProcessing(false)
				// Submit after processing is complete
				onSubmit({ preventDefault: () => {} } as React.MouseEvent)
			} else if (status === 'idle') {
				// Recording was stopped but failed to process
				setIsWaitingForProcessing(false)
			}
		}

		const interval = setInterval(checkStatus, 100)
		return () => clearInterval(interval)
	}, [isWaitingForProcessing, onSubmit])

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3">
				<AudioRecorder
					ref={audioRecorderRef}
					onAudioCaptured={onAudioCaptured}
					disabled={disabled}
				/>

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

			<div className="flex justify-end items-center gap-2">
				{(processingStatus || isWaitingForProcessing) && (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span>
							{isWaitingForProcessing
								? audioRecorderRef.current?.getStatus() === 'normalizing'
									? 'Normalizing audio...'
									: 'Processing recording...'
								: processingStatus === 'compressing'
									? 'Compressing audio...'
									: 'Submitting post...'}
						</span>
					</div>
				)}
				<Button type="button" onClick={handleSubmit} disabled={disabled || isWaitingForProcessing}>
					Post
				</Button>
			</div>
		</div>
	)
}

export default AudioPostTab
