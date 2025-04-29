import { useState, useRef } from 'react'
import { Video, Square, Play, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'

const VideoRecorder = ({ onVideoCaptured }: { onVideoCaptured: (videoBlob: Blob) => void }) => {
	const [isRecording, setIsRecording] = useState(false)
	const [videoURL, setVideoURL] = useState<string | null>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const videoChunksRef = useRef<Blob[]>([])
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const streamRef = useRef<MediaStream | null>(null)

	const startRecording = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
			streamRef.current = stream

			// Display preview
			if (videoRef.current) {
				videoRef.current.srcObject = stream
			}

			const mediaRecorder = new MediaRecorder(stream)
			mediaRecorderRef.current = mediaRecorder
			videoChunksRef.current = []

			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					videoChunksRef.current.push(e.data)
				}
			}

			mediaRecorder.onstop = () => {
				const videoBlob = new Blob(videoChunksRef.current, { type: 'video/mp4' })
				const videoUrl = URL.createObjectURL(videoBlob)
				setVideoURL(videoUrl)
				onVideoCaptured(videoBlob)

				// Remove preview
				if (videoRef.current) {
					videoRef.current.srcObject = null
				}
			}

			mediaRecorder.start()
			setIsRecording(true)
		} catch (error) {
			console.error('Error accessing camera/microphone:', error)
			toast.error('Unable to access camera or microphone. Please check permissions.')
		}
	}

	const stopRecording = () => {
		if (mediaRecorderRef.current && isRecording) {
			mediaRecorderRef.current.stop()
			// Stop all tracks
			if (streamRef.current) {
				for (const track of streamRef.current.getTracks()) {
					track.stop()
				}
			}
			setIsRecording(false)
		}
	}

	const togglePlayback = () => {
		if (videoRef.current && videoURL) {
			if (isPlaying) {
				videoRef.current.pause()
			} else {
				videoRef.current.play()
			}
			setIsPlaying(!isPlaying)
		}
	}

	const handlePlaybackEnded = () => {
		setIsPlaying(false)
	}

	return (
		<div className="flex flex-col space-y-2">
			<div className="relative">
				<video
					ref={videoRef}
					className={`w-full rounded-md ${isRecording || !videoURL ? 'h-60 bg-black/10' : 'h-auto'}`}
					autoPlay={isRecording}
					muted={isRecording}
					loop={false}
					playsInline
					src={videoURL || undefined}
					onEnded={handlePlaybackEnded}
				/>

				<div className="absolute bottom-2 right-2 flex gap-2">
					{!isRecording ? (
						<>
							{!videoURL && (
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={startRecording}
									className="bg-white/80 backdrop-blur-xs"
								>
									<Video className="h-5 w-5 text-primary" />
								</Button>
							)}

							{videoURL && (
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={togglePlayback}
									className="bg-white/80 backdrop-blur-xs"
								>
									{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
								</Button>
							)}
						</>
					) : (
						<Button
							type="button"
							variant="destructive"
							size="icon"
							onClick={stopRecording}
							className="animate-pulse-gentle"
						>
							<Square className="h-5 w-5" />
						</Button>
					)}
				</div>
			</div>

			{isRecording && <span className="text-sm text-primary">Recording video...</span>}
		</div>
	)
}

export default VideoRecorder
