import type React from 'react'
import { useState, useRef } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/sonner'
import TextPostTab from './TextPostTab'
import AudioPostTab from './AudioPostTab'
import VideoPostTab from './VideoPostTab'
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
	const [mediaType, setMediaType] = useState<'text' | 'audio' | 'video'>('text')
	const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
	const [videoBlob, setVideoBlob] = useState<Blob | null>(null)
	const [audioFile, setAudioFile] = useState<File | null>(null)
	const [videoFile, setVideoFile] = useState<File | null>(null)
	const [submitStatus, setSubmitStatus] = useState<SubmitStatus | ''>('')
	const textareaRef = useRef<HTMLTextAreaElement>(null)

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

	const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file?.type.startsWith('video/')) {
			setVideoFile(file)
			setVideoBlob(null)
			setMediaType('video')
		} else if (file) {
			toast.error('Please select a valid video file')
		}
	}

	const clearMedia = () => {
		setAudioBlob(null)
		setVideoBlob(null)
		setAudioFile(null)
		setVideoFile(null)
		setMediaType('text')
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (submitStatus) {
			return
		}

		if (!postText.trim() && !audioBlob && !audioFile && !videoBlob && !videoFile) {
			toast.error('Please enter some text or add media')
			return
		}

		setSubmitStatus('preparing')

		try {
			let finalMediaType: 'audio' | 'video' | undefined
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

	const handleTabSubmit = (e: React.MouseEvent) => {
		e.preventDefault()
		handleSubmit({ preventDefault: () => {} } as React.FormEvent)
	}

	return (
		<div className="bg-card rounded-lg shadow-xs p-4 border">
			<form onSubmit={handleSubmit}>
				<Textarea
					ref={textareaRef}
					placeholder="What's happening?"
					value={postText}
					onChange={handlePostTextChange}
					onKeyDown={handleKeyDown}
					className="w-full resize-none mb-4 border-none focus-visible:ring-0 py-2 px-3 text-base"
					disabled={!!submitStatus}
				/>

				<MediaPreview
					mediaType={mediaType}
					audioBlob={audioBlob}
					audioFile={audioFile}
					videoBlob={videoBlob}
					videoFile={videoFile}
					onClearMedia={clearMedia}
				/>

				<Tabs defaultValue="text" value={mediaType} className="mt-2">
					<TabsList className="grid w-full grid-cols-3 mb-4">
						<TabsTrigger
							value="text"
							onClick={() => setMediaType('text')}
							disabled={!!submitStatus}
						>
							Text
						</TabsTrigger>
						<TabsTrigger
							value="audio"
							onClick={() => setMediaType('audio')}
							disabled={!!submitStatus}
						>
							Audio
						</TabsTrigger>
						<TabsTrigger
							value="video"
							onClick={() => setMediaType('video')}
							disabled={!!submitStatus}
						>
							Video
						</TabsTrigger>
					</TabsList>

					<TabsContent value="text">
						<TextPostTab onSubmit={handleTabSubmit} disabled={!!submitStatus} />
					</TabsContent>

					<TabsContent value="audio">
						<AudioPostTab
							onAudioCaptured={handleAudioCaptured}
							onAudioFileChange={handleAudioFileChange}
							onSubmit={handleTabSubmit}
							disabled={!!submitStatus}
							submitStatus={
								mediaType === 'audio' && Boolean(audioBlob || audioFile) ? submitStatus : ''
							}
						/>
					</TabsContent>

					<TabsContent value="video">
						<VideoPostTab
							onVideoCaptured={handleVideoCaptured}
							onVideoFileChange={handleVideoFileChange}
							onSubmit={handleTabSubmit}
							disabled={!!submitStatus}
						/>
					</TabsContent>
				</Tabs>
			</form>
		</div>
	)
}

export default CreatePost
