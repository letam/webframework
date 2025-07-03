import type React from 'react'
import { useState, useRef } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Mic, Video, Image, Loader2, Upload } from 'lucide-react'
import { AudioRecorderModal } from './AudioRecorder'
import { VideoRecorderModal } from './VideoRecorder'
import MediaPreview from './MediaPreview'
import type { CreatePostRequest } from '@/types/post'
import { convertWavToWebM, getAudioExtension } from '@/lib/utils/audio'
import { getSettings } from '@/lib/utils/settings'

interface CreatePostProps {
	onPostCreated: (post: CreatePostRequest) => void
}

type SubmitStatus = '' | 'preparing' | 'compressing' | 'submitting'

const getMediaExtension = (mimeType: string, mediaType: 'audio' | 'video'): string => {
	if (mediaType === 'audio') {
		return getAudioExtension(mimeType)
	}
	const baseType = mimeType.split(';')[0] // Remove codec information
	return baseType === 'video/webm'
		? 'webm'
		: baseType === 'video/mp4'
			? 'mp4'
			: baseType === 'video/ogg'
				? 'ogg'
				: 'webm' // Default to webm as it's most widely supported
}

const CreatePost: React.FC<CreatePostProps> = ({ onPostCreated }) => {
	const [postText, setPostText] = useState('')
	const [mediaType, setMediaType] = useState<'text' | 'audio' | 'video' | 'image'>('text')
	const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
	const [videoBlob, setVideoBlob] = useState<Blob | null>(null)
	const [audioFile, setAudioFile] = useState<File | null>(null)
	const [videoFile, setVideoFile] = useState<File | null>(null)
	const [imageFile, setImageFile] = useState<File | null>(null)
	const [submitStatus, setSubmitStatus] = useState<SubmitStatus | ''>('')
	const [isAudioModalOpen, setIsAudioModalOpen] = useState(false)
	const [isVideoModalOpen, setIsVideoModalOpen] = useState(false)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const audioInputRef = useRef<HTMLInputElement>(null)
	const uploadInputRef = useRef<HTMLInputElement>(null)
	const imageInputRef = useRef<HTMLInputElement>(null)

	const hasNoMedia = !audioBlob && !audioFile && !videoBlob && !videoFile && !imageFile

	const handleKeyDown = (e: React.KeyboardEvent) => {
		// Check for Cmd+Enter (macOS) or Ctrl+Enter (Windows/Linux)
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault()
			handleSubmit({ preventDefault: () => {} } as React.FormEvent)
		}
	}

	const handlePostTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setPostText(e.target.value)
	}

	const handleAudioCaptured = (blob: Blob) => {
		setAudioBlob(blob)
		setMediaType('audio')
	}

	const handleVideoCaptured = (blob: Blob) => {
		setVideoBlob(blob)
		setVideoFile(null)
		setMediaType('video')
	}

	const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file?.type.startsWith('audio/')) {
			setAudioFile(file)
			setAudioBlob(null)
			setMediaType('audio')
		} else if (file) {
			toast.error('Please select a valid audio file')
		}
	}

	const handleUploadFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) {
			toast.error('Please select a valid file')
			return
		}

		if (file.name.endsWith('.webm')) {
			// TODO: Detect if it's an audio vs video file
			setAudioFile(file)
			setAudioBlob(null)
			setMediaType('audio')
		} else if (file.type.startsWith('audio/')) {
			setAudioFile(file)
			setAudioBlob(null)
			setMediaType('audio')
		} else if (file.type.startsWith('video/')) {
			setVideoFile(file)
			setVideoBlob(null)
			setMediaType('video')
		} else if (file.type.startsWith('image/')) {
			setImageFile(file)
			setMediaType('image')
		} else {
			toast.error('Please select a valid file')
		}
	}

	const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file?.type.startsWith('image/')) {
			setImageFile(file)
			setMediaType('image')
		} else if (file) {
			toast.error('Please select a valid image file')
		}
	}

	const clearMedia = () => {
		setAudioBlob(null)
		setVideoBlob(null)
		setAudioFile(null)
		setVideoFile(null)
		setImageFile(null)
		setMediaType('text')
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (submitStatus) {
			return
		}

		if (!postText.trim() && !audioBlob && !audioFile && !videoBlob && !videoFile && !imageFile) {
			toast.error('Please enter some text or add media')
			return
		}

		setSubmitStatus('preparing')

		try {
			let finalMediaType: 'audio' | 'video' | 'image' | undefined
			let file: File | null = null

			if (mediaType === 'audio' && (audioBlob || audioFile)) {
				const blob = audioFile || audioBlob
				if (blob) {
					finalMediaType = 'audio'
					if (!(blob instanceof File)) {
						// Only convert to WebM if normalization is enabled (since normalization converts the blob to WAV)
						if (getSettings().normalizeAudio) {
							setSubmitStatus('compressing')
							const webmBlob = await convertWavToWebM(blob)
							file = new File([webmBlob], `recording_${Date.now()}.webm`, {
								type: 'audio/webm;codecs=opus',
							})
						} else {
							const extension = getMediaExtension(blob.type, 'audio')
							file = new File([blob], `recording_${Date.now()}.${extension}`, { type: blob.type })
						}
					} else {
						file = blob
					}
				}
			} else if (mediaType === 'video' && (videoBlob || videoFile)) {
				const blob = videoFile || videoBlob
				if (blob) {
					finalMediaType = 'video'
					if (!(blob instanceof File)) {
						const extension = getMediaExtension(blob.type, 'video')
						file = new File([blob], `recording_${Date.now()}.${extension}`, { type: blob.type })
					} else {
						file = blob
					}
				}
			} else if (mediaType === 'image' && imageFile) {
				finalMediaType = 'image'
				file = imageFile
			}

			setSubmitStatus('submitting')
			const newPost: CreatePostRequest = {
				text: postText,
				media_type: finalMediaType,
				media: file,
			}

			await onPostCreated(newPost)
			// Reset form only on success
			setPostText('')
			clearMedia()
			toast.success('Post created successfully!')
			// Focus back on text area
			textareaRef.current?.focus()
		} catch (error) {
			toast.error('Failed to create post')
		} finally {
			setSubmitStatus('')
		}
	}

	const openUploadFileSelector = () => {
		uploadInputRef.current?.click()
	}

	const openImageFileSelector = () => {
		imageInputRef.current?.click()
	}

	return (
		<div className="bg-card rounded-lg shadow-xs border max-w-lg mx-auto px-4 py-2">
			<form onSubmit={handleSubmit} className="flex flex-col w-full">
				<div className="-mx-2">
					<Textarea
						ref={textareaRef}
						placeholder="What's on your mind? Share your thoughts, upload media, or record something..."
						value={postText}
						onChange={handlePostTextChange}
						onKeyDown={handleKeyDown}
						className="w-full resize-none mb-4 border-none focus-visible:ring-0 py-1 px-2 text-base max-w-lg"
						rows={4}
						disabled={!!submitStatus}
					/>
				</div>

				<div className={submitStatus ? 'hidden' : ''}>
					<MediaPreview
						mediaType={mediaType}
						audioBlob={audioBlob}
						audioFile={audioFile}
						videoBlob={videoBlob}
						videoFile={videoFile}
						imageFile={imageFile}
						onClearMedia={clearMedia}
					/>
				</div>

				{hasNoMedia && (
					<div className="grid grid-cols-2 gap-3 mb-4">
						<Button
							type="button"
							variant="outline"
							className="flex items-center gap-2 py-4"
							onClick={() => setIsAudioModalOpen(true)}
							disabled={!!submitStatus}
						>
							<Mic className="h-5 w-5" />
							<span className="text-base font-medium">Record Audio</span>
						</Button>
						<Button
							type="button"
							variant="outline"
							className="flex items-center gap-2 py-4"
							onClick={() => setIsVideoModalOpen(true)}
							disabled={!!submitStatus}
						>
							<Video className="h-5 w-5" />
							<span className="text-base font-medium">Record Video</span>
						</Button>
						<Button
							type="button"
							variant="outline"
							className="flex items-center gap-2 py-4"
							onClick={openImageFileSelector}
							disabled={!!submitStatus}
						>
							<Image className="h-5 w-5" />
							<span className="text-base font-medium">Image</span>
						</Button>
						<Button
							type="button"
							variant="outline"
							className="flex items-center gap-2 py-4"
							onClick={openUploadFileSelector}
							disabled={!!submitStatus}
						>
							<Upload className="h-5 w-5" />
							<span className="text-base font-medium">Upload</span>
						</Button>
						<input
							type="file"
							ref={audioInputRef}
							className="hidden"
							accept="audio/*"
							onChange={handleAudioFileChange}
							disabled={!!submitStatus}
						/>
						<input
							type="file"
							ref={uploadInputRef}
							className="hidden"
							accept={
								'audio/mp3, audio/wav, audio/mp4, audio/x-m4a, audio/aiff, audio/x-m4b' +
								', video/*, image/*'
							}
							onChange={handleUploadFileChange}
							disabled={!!submitStatus}
						/>
						<input
							type="file"
							ref={imageInputRef}
							className="hidden"
							accept="image/*"
							onChange={handleImageFileChange}
							disabled={!!submitStatus}
						/>
					</div>
				)}

				{submitStatus && (
					<div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span>
							{submitStatus === 'compressing'
								? 'Compressing media...'
								: submitStatus === 'preparing'
									? 'Preparing post...'
									: 'Submitting post...'}
						</span>
					</div>
				)}
				<Button
					type="submit"
					disabled={!!submitStatus}
					className="w-full py-4 text-base font-medium"
				>
					Post
				</Button>
			</form>

			<AudioRecorderModal
				open={isAudioModalOpen}
				onOpenChange={setIsAudioModalOpen}
				onAudioCaptured={(blob) => {
					handleAudioCaptured(blob)
					setIsAudioModalOpen(false)
				}}
			/>

			<VideoRecorderModal
				open={isVideoModalOpen}
				onOpenChange={setIsVideoModalOpen}
				onVideoCaptured={(blob) => {
					handleVideoCaptured(blob)
					setIsVideoModalOpen(false)
				}}
			/>
		</div>
	)
}

export default CreatePost
