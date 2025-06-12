import type React from 'react'
import { X, FileAudio, FileVideo, Video, Image } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AudioControls } from '@/components/post/MediaPlayer'
import { useState, useRef, useEffect } from 'react'

interface MediaPreviewProps {
	mediaType: 'audio' | 'video' | 'image' | 'text'
	audioBlob: Blob | null
	audioFile: File | null
	videoBlob: Blob | null
	videoFile: File | null
	imageFile: File | null
	onClearMedia: () => void
}

const MediaPreview: React.FC<MediaPreviewProps> = ({
	mediaType,
	audioBlob,
	audioFile,
	videoBlob,
	videoFile,
	imageFile,
	onClearMedia,
}) => {
	const [isPlaying, setIsPlaying] = useState(false)
	const [duration, setDuration] = useState<number>(0)
	const [currentTime, setCurrentTime] = useState<number>(0)
	const [audioUrl, setAudioUrl] = useState<string | null>(null)
	const [videoUrl, setVideoUrl] = useState<string | null>(null)
	const [imageUrl, setImageUrl] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const progressIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

	// Create and cleanup media URLs
	useEffect(() => {
		if (mediaType === 'audio') {
			const source = audioBlob || audioFile
			if (source) {
				const url = URL.createObjectURL(source)
				setAudioUrl(url)
				// Reset state when audio source changes
				setIsPlaying(false)
				setDuration(0)
				setCurrentTime(0)
				setError(null)
				if (progressIntervalRef.current) {
					clearInterval(progressIntervalRef.current)
				}
				return () => {
					URL.revokeObjectURL(url)
					setAudioUrl(null)
				}
			}
		} else if (mediaType === 'video') {
			const source = videoBlob || videoFile
			if (source) {
				const url = URL.createObjectURL(source)
				setVideoUrl(url)
				return () => {
					URL.revokeObjectURL(url)
					setVideoUrl(null)
				}
			}
		} else if (mediaType === 'image' && imageFile) {
			const url = URL.createObjectURL(imageFile)
			setImageUrl(url)
			return () => {
				URL.revokeObjectURL(url)
				setImageUrl(null)
			}
		}
	}, [mediaType, audioBlob, audioFile, videoBlob, videoFile, imageFile])

	// Cleanup interval on unmount
	useEffect(() => {
		return () => {
			if (progressIntervalRef.current) {
				clearInterval(progressIntervalRef.current)
			}
		}
	}, [])

	if (!audioBlob && !audioFile && !videoBlob && !videoFile && !imageFile) {
		return null
	}

	const handleTimeUpdate = () => {
		if (audioRef.current) {
			const currentTime = audioRef.current.currentTime
			setCurrentTime(currentTime)
			// If we're very close to the end, let the ended event handle it
			if (currentTime >= duration - 0.1) {
				if (progressIntervalRef.current) {
					clearInterval(progressIntervalRef.current)
				}
			}
		}
	}

	const handleLoadedMetadata = () => {
		if (audioRef.current) {
			// Add a small buffer to the duration to prevent early cutoff
			setDuration(audioRef.current.duration + 0.1)
			setError(null)
		}
	}

	const handleError = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
		const audio = e.target as HTMLAudioElement
		const error = audio.error
		if (error) {
			let errorMessage = 'Audio playback error: '
			switch (error.code) {
				case MediaError.MEDIA_ERR_ABORTED:
					errorMessage += 'Playback was interrupted.'
					break
				case MediaError.MEDIA_ERR_NETWORK:
					errorMessage += 'A network error occurred.'
					break
				case MediaError.MEDIA_ERR_DECODE:
					errorMessage += 'The audio format is not supported.'
					break
				case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
					errorMessage += 'The audio source is not supported.'
					break
				default:
					errorMessage += 'An unknown error occurred.'
			}
			setError(errorMessage)
			setIsPlaying(false)
			if (progressIntervalRef.current) {
				clearInterval(progressIntervalRef.current)
			}
		}
	}

	const seekAudio = (seconds: number) => {
		if (audioRef.current) {
			audioRef.current.currentTime = Math.max(0, Math.min(seconds, duration))
		}
	}

	const togglePlayback = async () => {
		if (audioRef.current) {
			try {
				if (isPlaying) {
					audioRef.current.pause()
					if (progressIntervalRef.current) {
						clearInterval(progressIntervalRef.current)
					}
					setIsPlaying(false)
				} else {
					// Reset all other audio playback first
					for (const audio of document.querySelectorAll('audio')) {
						if (audio !== audioRef.current) {
							audio.pause()
						}
					}

					await audioRef.current.play()
					// Use a shorter interval for smoother progress updates
					progressIntervalRef.current = setInterval(handleTimeUpdate, 50)
					setIsPlaying(true)
					setError(null)
				}
			} catch (err) {
				console.error('Audio playback error:', err)
				setError('Failed to play audio. Please try again.')
				setIsPlaying(false)
			}
		}
	}

	const handlePlaybackEnded = () => {
		setIsPlaying(false)
		setCurrentTime(duration) // Set to exact duration
		if (progressIntervalRef.current) {
			clearInterval(progressIntervalRef.current)
		}
	}

	return (
		<div className="relative mb-4 bg-accent/10 rounded-md p-4">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="absolute top-2 right-2 h-6 w-6"
				onClick={onClearMedia}
			>
				<X className="h-4 w-4" />
			</Button>

			{mediaType === 'audio' && (audioBlob || audioFile) && (
				<div className="flex flex-col gap-2">
					<div className="flex items-center space-x-2 text-sm text-muted-foreground">
						<FileAudio className="h-4 w-4" />
						<span>{audioFile ? audioFile.name : 'Voice recording'}</span>
					</div>
					{audioUrl && (
						<>
							<audio
								ref={audioRef}
								src={audioUrl}
								onTimeUpdate={handleTimeUpdate}
								onEnded={handlePlaybackEnded}
								onLoadedMetadata={handleLoadedMetadata}
								onError={handleError}
								preload="metadata"
							>
								<track kind="captions" label="English" />
							</audio>
							{error ? (
								<div className="text-sm text-destructive">{error}</div>
							) : (
								<AudioControls
									audioRef={audioRef}
									duration={duration}
									currentTime={currentTime}
									isPlaying={isPlaying}
									onSeek={seekAudio}
									onPlayPause={togglePlayback}
								/>
							)}
						</>
					)}
				</div>
			)}

			{mediaType === 'video' && (videoBlob || videoFile) && (
				<div className="flex flex-col gap-2">
					<div className="flex items-center space-x-2 text-sm text-muted-foreground">
						{videoFile ? <FileVideo className="h-4 w-4" /> : <Video className="h-4 w-4" />}
						<span>{videoFile ? videoFile.name : 'Video recording'}</span>
					</div>
					{videoUrl && (
						<div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
							<video
								ref={videoRef}
								src={videoUrl}
								controls
								className="w-full h-full object-contain"
								onPlay={() => setIsPlaying(true)}
								onPause={() => setIsPlaying(false)}
								onEnded={() => setIsPlaying(false)}
							>
								<track kind="captions" label="English" />
							</video>
						</div>
					)}
				</div>
			)}

			{mediaType === 'image' && imageFile && (
				<div className="flex flex-col gap-2">
					<div className="flex items-center space-x-2 text-sm text-muted-foreground">
						<Image className="h-4 w-4" />
						<span>{imageFile.name}</span>
					</div>
					{imageUrl && (
						<div className="relative w-full overflow-hidden rounded-md bg-black">
							<img
								src={imageUrl}
								alt={imageFile.name}
								className="w-full h-auto object-contain max-h-[400px]"
							/>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default MediaPreview
