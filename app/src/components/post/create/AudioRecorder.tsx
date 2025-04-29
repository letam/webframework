import { useState, useRef } from 'react'
import { Mic, Square, Play, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'

const AudioRecorder = ({ onAudioCaptured }: { onAudioCaptured: (audioBlob: Blob) => void }) => {
	const [isRecording, setIsRecording] = useState(false)
	const [audioURL, setAudioURL] = useState<string | null>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const audioChunksRef = useRef<Blob[]>([])
	const audioRef = useRef<HTMLAudioElement | null>(null)

	const startRecording = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
			const mediaRecorder = new MediaRecorder(stream)
			mediaRecorderRef.current = mediaRecorder
			audioChunksRef.current = []

			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					audioChunksRef.current.push(e.data)
				}
			}

			mediaRecorder.onstop = () => {
				const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/mp3' })
				const audioUrl = URL.createObjectURL(audioBlob)
				setAudioURL(audioUrl)
				onAudioCaptured(audioBlob)
			}

			mediaRecorder.start()
			setIsRecording(true)
		} catch (error) {
			console.error('Error accessing microphone:', error)
			toast.error('Unable to access microphone. Please check permissions.')
		}
	}

	const stopRecording = () => {
		if (mediaRecorderRef.current && isRecording) {
			mediaRecorderRef.current.stop()
			// Stop all audio tracks
			for (const track of mediaRecorderRef.current.stream.getTracks()) {
				track.stop()
			}
			setIsRecording(false)
		}
	}

	const togglePlayback = () => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause()
			} else {
				audioRef.current.play()
			}
			setIsPlaying(!isPlaying)
		}
	}

	const handlePlaybackEnded = () => {
		setIsPlaying(false)
	}

	return (
		<div className="flex flex-col space-y-2">
			<div className="flex items-center space-x-2">
				{!isRecording ? (
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={startRecording}
						className="w-10 h-10 rounded-full"
					>
						<Mic className="h-5 w-5 text-primary" />
					</Button>
				) : (
					<Button
						type="button"
						variant="destructive"
						size="icon"
						onClick={stopRecording}
						className="w-10 h-10 rounded-full animate-pulse-gentle"
					>
						<Square className="h-5 w-5" />
					</Button>
				)}

				{audioURL && !isRecording && (
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={togglePlayback}
						className="w-10 h-10 rounded-full"
					>
						{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
					</Button>
				)}

				{isRecording && <span className="text-sm text-primary">Recording...</span>}

				{audioURL && !isRecording && (
					<span className="text-sm text-muted-foreground">Audio recorded</span>
				)}
			</div>

			{audioURL && (
				<audio ref={audioRef} src={audioURL} className="hidden" onEnded={handlePlaybackEnded}>
					<track kind="captions" label="English" />
				</audio>
			)}
		</div>
	)
}

export default AudioRecorder
