import type React from 'react'
import { useState, useRef } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Mic, Video, Image, Loader2, Upload, Send } from 'lucide-react'
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
		} catch {
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

	const mediaTiles = [
		{ icon: Mic, label: 'Record Audio', onClick: () => setIsAudioModalOpen(true) },
		{ icon: Video, label: 'Record Video', onClick: () => setIsVideoModalOpen(true) },
		{ icon: Image, label: 'Image', onClick: openImageFileSelector },
		{ icon: Upload, label: 'Upload', onClick: openUploadFileSelector },
	]

	return (
		<div className="dispatch mx-auto max-w-lg rounded-xl border border-border bg-card px-4 py-3.5 shadow-[0_1px_0_hsl(var(--border))] sm:px-5">
			<div className="mb-2 flex items-center gap-2">
				<span className="on-air-dot" />
				<span className="eyebrow">Compose · New Dispatch</span>
			</div>
			<form onSubmit={handleSubmit} className="flex w-full flex-col">
				<div className="-mx-2">
					<Textarea
						ref={textareaRef}
						placeholder="What are you hearing? Share a thought, record a voice note, or drop some media…"
						value={postText}
						onChange={handlePostTextChange}
						onKeyDown={handleKeyDown}
						className="mb-4 w-full max-w-lg resize-none border-none bg-transparent px-2 py-1 text-base leading-relaxed placeholder:text-muted-foreground/70 focus-visible:ring-0"
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
					<div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
						{mediaTiles.map(({ icon: Icon, label, onClick }) => (
							<button
								key={label}
								type="button"
								className="group/tile flex flex-col items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2 py-3 text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-50"
								onClick={onClick}
								disabled={!!submitStatus}
							>
								<Icon className="h-5 w-5 text-muted-foreground transition-colors group-hover/tile:text-primary" />
								<span className="font-mono text-[0.62rem] uppercase tracking-wide">{label}</span>
							</button>
						))}
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
					<div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin text-primary" />
						<span>
							{submitStatus === 'compressing'
								? 'Compressing media…'
								: submitStatus === 'preparing'
									? 'Preparing dispatch…'
									: 'Broadcasting…'}
						</span>
					</div>
				)}
				<Button
					type="submit"
					disabled={!!submitStatus}
					className="group/post w-full gap-2 py-5 text-base font-semibold tracking-wide shadow-[0_2px_0_hsl(var(--primary)/0.5)] transition-all hover:shadow-[0_1px_0_hsl(var(--primary)/0.5)] active:translate-y-0.5"
				>
					<Send className="h-4 w-4 transition-transform group-hover/post:translate-x-0.5 group-hover/post:-translate-y-0.5" />
					Broadcast
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
