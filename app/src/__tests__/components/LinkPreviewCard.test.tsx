import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LinkPreviewCard from '@/components/post/LinkPreviewCard'
import { makeLinkPreview } from '../data/mockPosts'

describe('LinkPreviewCard', () => {
	it('renders a generic card with hostname fallback, metadata, image, and anchor attrs', () => {
		const preview = makeLinkPreview({
			url: 'https://www.example.com/story',
			site_name: '',
			title: 'Generic title',
			description: 'Generic description',
			image: 'https://cdn.example.com/image.jpg',
		})

		render(<LinkPreviewCard preview={preview} />)

		const card = screen.getByTestId('link-preview-generic')
		expect(within(card).getByText('example.com')).toBeInTheDocument()
		expect(within(card).getByText('Generic title')).toBeInTheDocument()
		expect(within(card).getByText('Generic description')).toBeInTheDocument()
		expect(card).toHaveAttribute('href', 'https://www.example.com/story')
		expect(card).toHaveAttribute('target', '_blank')
		expect(card).toHaveAttribute('rel', 'noopener noreferrer')
		expect(card.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/image.jpg')
	})

	it('renders a YouTube card and swaps the media area for an autoplay iframe', () => {
		const preview = makeLinkPreview({
			kind: 'youtube',
			url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			title: 'Video title',
			description: 'Video description',
			site_name: 'YouTube',
			author_name: 'Channel Name',
			embed_id: 'dQw4w9WgXcQ',
			image: 'https://example.com/thumb.jpg',
		})

		render(<LinkPreviewCard preview={preview} />)

		expect(screen.getByAltText('Video title')).toHaveAttribute(
			'src',
			'https://example.com/thumb.jpg'
		)
		expect(screen.getByText('Channel Name · YouTube')).toBeInTheDocument()
		expect(screen.getByText('Video description')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Play video' }))

		expect(screen.getByTitle('Video title')).toHaveAttribute(
			'src',
			'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1'
		)
	})

	it('renders a Twitter/X quote card', () => {
		const preview = makeLinkPreview({
			kind: 'twitter',
			url: 'https://x.com/somebody/status/123',
			author_name: 'Some Body',
			author_handle: 'somebody',
			description: 'Tweet text goes here.',
		})

		render(<LinkPreviewCard preview={preview} />)

		const card = screen.getByTestId('link-preview-twitter')
		expect(within(card).getByText('Some Body')).toBeInTheDocument()
		expect(within(card).getByText('@somebody')).toBeInTheDocument()
		expect(within(card).getByText('Tweet text goes here.')).toBeInTheDocument()
	})
})
