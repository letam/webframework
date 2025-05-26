import type React from 'react'
import { useState, useRef, useEffect } from 'react'
import { Play, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AudioPlayerProps {
	audioUrl: string
	mimeType: string
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioUrl, mimeType }) => {
	const [isPlaying, setIsPlaying] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [showLoading, setShowLoading] = useState(false)
	const [isLoaded, setIsLoaded] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const audioBlobRef = useRef<Blob | null>(null)
	const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	// biome-ignore lint/correctness/useExhaustiveDependencies: executed when audioUrl changes
	useEffect(() => {
		setIsPlaying(false)
		setError(null)
		setIsLoading(false)
		setShowLoading(false)
		setIsLoaded(false)
		audioBlobRef.current = null
		const player = audioRef.current

		return () => {
			if (player) {
				player.pause()
				player.removeAttribute('src')
				player.load()
			}
			if (loadingTimeoutRef.current) {
				clearTimeout(loadingTimeoutRef.current)
			}
		}
	}, [audioUrl])

	useEffect(() => {
		if (isLoading) {
			loadingTimeoutRef.current = setTimeout(() => {
				setShowLoading(true)
			}, 500)
		} else {
			setShowLoading(false)
			if (loadingTimeoutRef.current) {
				clearTimeout(loadingTimeoutRef.current)
			}
		}

		return () => {
			if (loadingTimeoutRef.current) {
				clearTimeout(loadingTimeoutRef.current)
			}
		}
	}, [isLoading])

	const loadAudio = async () => {
		if (audioBlobRef.current) {
			// Audio is already cached
			if (audioRef.current) {
				audioRef.current.src = URL.createObjectURL(audioBlobRef.current)
			}
			return
		}

		setIsLoading(true)
		setError(null)

		try {
			const response = await fetch(audioUrl)
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}
			const blob = await response.blob()
			audioBlobRef.current = blob

			if (audioRef.current) {
				audioRef.current.src = URL.createObjectURL(blob)
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to load audio'
			setError(`Failed to load audio: ${errorMessage}`)
			setIsLoading(false)
		}
	}

	const handleError = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
		const audio = e.target as HTMLAudioElement
		const error = audio.error
		if (error) {
			let errorMessage = 'Audio playback error: '
			switch (error.code) {
				case MediaError.MEDIA_ERR_ABORTED:
					errorMessage += 'Playback was interrupted. Please try again.'
					break
				case MediaError.MEDIA_ERR_NETWORK:
					errorMessage += 'A network error occurred. Please check your connection.'
					break
				case MediaError.MEDIA_ERR_DECODE:
					errorMessage += 'The audio format is not supported by your browser.'
					break
				case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
					errorMessage += 'The audio source is not supported.'
					break
				default:
					errorMessage += 'An unknown error occurred.'
			}
			setError(errorMessage)
			setIsLoading(false)
			console.error('Audio error details:', error)
		}
	}

	const handleLoadedMetadata = () => {
		setIsLoading(false)
		setIsLoaded(true)
		setError(null)
	}

	const togglePlayback = async () => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause()
				setIsPlaying(false)
			} else {
				if (!isLoaded) {
					await loadAudio()
				}

				// Reset all other audio playback first
				for (const audio of document.querySelectorAll('audio')) {
					if (audio !== audioRef.current) {
						audio.pause()
					}
				}

				// Play this audio
				audioRef.current
					.play()
					.then(() => {
						setIsPlaying(true)
						setError(null)
					})
					.catch((error) => {
						console.error('Audio playback error:', error)
						setIsPlaying(false)
						setError(`Failed to play audio: ${error.message}`)
					})
			}
		}
	}

	const handleEnded = () => {
		setIsPlaying(false)
	}

	return (
		<div className="mt-4 bg-accent/10 rounded-md p-3 relative">
			<div className="flex items-center gap-3">
				<Button
					type="button"
					variant="outline"
					size="icon"
					onClick={togglePlayback}
					className="h-10 w-10 rounded-full"
					disabled={isLoading}
				>
					{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
				</Button>

				<div className="grow">
					<div className="h-1 bg-primary/20 rounded-full">
						<div
							className="h-full bg-primary rounded-full"
							style={{
								width: isPlaying ? '100%' : '0',
								transition: 'width linear 0.1s',
							}}
						/>
					</div>
				</div>

				<audio
					ref={audioRef}
					onEnded={handleEnded}
					onError={handleError}
					onLoadedMetadata={handleLoadedMetadata}
					preload="none"
				>
					<track kind="captions" label="English" />
				</audio>
			</div>

			{showLoading && (
				<div className="absolute inset-0 flex items-center justify-center bg-accent/10 backdrop-blur-sm">
					<div className="text-sm text-muted-foreground">Loading audio...</div>
				</div>
			)}

			{error && (
				<div className="absolute inset-0 flex items-center justify-center bg-accent/10 backdrop-blur-sm">
					<div className="text-sm text-destructive text-center p-4">
						<p>{error}</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								setError(null)
								setIsLoading(true)
								setIsLoaded(false)
								audioBlobRef.current = null
								if (audioRef.current) {
									audioRef.current.load()
								}
							}}
							className="mt-2"
						>
							Try Again
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}

interface VideoPlayerProps {
	videoUrl: string
	mimeType: string
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ videoUrl, mimeType }) => {
	const [isPlaying, setIsPlaying] = useState(false)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [isLoaded, setIsLoaded] = useState(false)
	const videoBlobRef = useRef<Blob | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: executed when videoUrl changes
	useEffect(() => {
		setIsPlaying(false)
		setError(null)
		setIsLoading(false)
		setIsLoaded(false)
		videoBlobRef.current = null
		const player = videoRef.current

		// Cleanup function
		return () => {
			if (player) {
				player.pause()
				player.removeAttribute('src')
				player.load()
			}
		}
	}, [videoUrl])

	const loadVideo = async () => {
		if (videoBlobRef.current) {
			// Video is already cached
			if (videoRef.current) {
				videoRef.current.src = URL.createObjectURL(videoBlobRef.current)
			}
			return
		}

		setIsLoading(true)
		setError(null)

		try {
			const response = await fetch(videoUrl)
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}
			const blob = await response.blob()
			videoBlobRef.current = blob

			if (videoRef.current) {
				videoRef.current.src = URL.createObjectURL(blob)
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to load video'
			setError(`Failed to load video: ${errorMessage}`)
			setIsLoading(false)
		}
	}

	const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
		const video = e.target as HTMLVideoElement
		const error = video.error
		if (error) {
			let errorMessage = 'Video playback error: '
			switch (error.code) {
				case MediaError.MEDIA_ERR_ABORTED:
					errorMessage += 'Playback was interrupted. Please try again.'
					break
				case MediaError.MEDIA_ERR_NETWORK:
					errorMessage += 'A network error occurred. Please check your connection.'
					break
				case MediaError.MEDIA_ERR_DECODE:
					errorMessage += 'The video format is not supported by your browser.'
					break
				case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
					errorMessage += 'The video source is not supported.'
					break
				default:
					errorMessage += 'An unknown error occurred.'
			}
			setError(errorMessage)
			setIsLoading(false)
			console.error('Video error details:', error)
		}
	}

	const handleLoadedMetadata = () => {
		console.log('derp loaded metadata')
		setIsLoading(false)
		setIsLoaded(true)
		setError(null)
	}

	const togglePlayback = async () => {
		if (videoRef.current) {
			if (isPlaying) {
				videoRef.current.pause()
				setIsPlaying(false)
			} else {
				if (!isLoaded) {
					await loadVideo()
				}

				// Reset all other video playback first
				for (const video of document.querySelectorAll('video')) {
					if (video !== videoRef.current) {
						video.pause()
					}
				}

				// Play this video
				videoRef.current
					.play()
					.then(() => {
						setIsPlaying(true)
						setError(null)
					})
					.catch((error) => {
						console.error('Video playback error:', error)
						setIsPlaying(false)
						setError(`Failed to play video: ${error.message}`)
					})
			}
		}
	}

	const handleEnded = () => {
		setIsPlaying(false)
	}

	return (
		<div className="mt-4 relative rounded-md overflow-hidden">
			<video
				ref={videoRef}
				className="w-full rounded-md"
				onEnded={handleEnded}
				onError={handleError}
				onLoadedMetadata={handleLoadedMetadata}
				controls={isPlaying}
			>
				<track kind="captions" label="English" />
				Your browser does not support the video tag.
			</video>

			{isLoading && (
				<div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
					Loading video...
				</div>
			)}

			{!isPlaying && !isLoading && !error && (
				<Button
					type="button"
					variant="outline"
					size="icon"
					onClick={togglePlayback}
					className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-primary/80 hover:bg-primary"
				>
					<Play className="h-6 w-6 text-white" />
				</Button>
			)}

			{error && (
				<div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white p-4 text-center">
					<div>
						<p>{error}</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								setError(null)
								setIsLoading(true)
								setIsLoaded(false)
								videoBlobRef.current = null
								if (videoRef.current) {
									videoRef.current.load()
								}
							}}
							className="mt-2"
						>
							Try Again
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}
