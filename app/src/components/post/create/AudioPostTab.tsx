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
	submitStatus?: '' | 'preparing' | 'compressing' | 'submitting'
}

const AudioPostTab: React.FC<AudioPostTabProps> = ({
	onAudioCaptured,
	onAudioFileChange,
	onSubmit,
	disabled,
	submitStatus = '',
}) => {
	const audioInputRef = useRef<HTMLInputElement>(null)
	const audioRecorderRef = useRef<AudioRecorderRef>(null)
	const [isProcessing, setIsProcessing] = useState(false)

	const openAudioFileSelector = () => {
		audioInputRef.current?.click()
	}

	const handleSubmit = (e: React.MouseEvent) => {
		if (isProcessing) return

		const status = audioRecorderRef.current?.getStatus()
		if (status === 'recording') {
			setIsProcessing(true)
			audioRecorderRef.current?.stopRecording()
		} else if (status === 'ready') {
			onSubmit(e)
		}
	}

	// Watch for recording completion
	useEffect(() => {
		if (!isProcessing) return

		const checkStatus = () => {
			const status = audioRecorderRef.current?.getStatus()
			if (status === 'ready') {
				setIsProcessing(false)
				onSubmit({ preventDefault: () => {} } as React.MouseEvent)
			} else if (status === 'idle') {
				setIsProcessing(false)
			}
		}

		const interval = setInterval(checkStatus, 100)
		return () => clearInterval(interval)
	}, [isProcessing, onSubmit])

	const getStatusMessage = () => {
		if (!isProcessing && !submitStatus) return null

		if (isProcessing) {
			const status = audioRecorderRef.current?.getStatus()
			return status === 'normalizing' ? 'Normalizing audio...' : 'Processing recording...'
		}

		return submitStatus === 'compressing' ? 'Compressing audio...' : 'Submitting post...'
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3">
				<AudioRecorder
					ref={audioRecorderRef}
					onAudioCaptured={onAudioCaptured}
					disabled={disabled}
					submitStatus={submitStatus}
					isProcessing={isProcessing}
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
				{getStatusMessage() && (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span>{getStatusMessage()}</span>
					</div>
				)}
				<Button type="button" onClick={handleSubmit} disabled={disabled || isProcessing}>
					Post
				</Button>
			</div>
		</div>
	)
}

export default AudioPostTab
