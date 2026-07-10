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
			published_at: '2024-05-01',
			image: 'https://cdn.example.com/image.jpg',
		})

		render(<LinkPreviewCard preview={preview} />)

		const card = screen.getByTestId('link-preview-generic')
		expect(within(card).getByText('example.com · May 1, 2024')).toBeInTheDocument()
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
			published_at: '2009-10-24',
			image: 'https://example.com/thumb.jpg',
		})

		render(<LinkPreviewCard preview={preview} />)

		expect(screen.getByAltText('Video title')).toHaveAttribute(
			'src',
			'https://example.com/thumb.jpg'
		)
		expect(screen.getByText('Channel Name · YouTube · Oct 24, 2009')).toBeInTheDocument()
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

	it('renders the tweet date when present and omits it when missing', () => {
		const preview = makeLinkPreview({
			kind: 'twitter',
			url: 'https://x.com/jack/status/20',
			author_name: 'jack',
			author_handle: 'jack',
			description: 'just setting up my twttr',
			published_at: '2006-03-21',
		})

		const { rerender } = render(<LinkPreviewCard preview={preview} />)
		expect(screen.getByText('Mar 21, 2006')).toBeInTheDocument()

		rerender(<LinkPreviewCard preview={{ ...preview, published_at: null }} />)
		expect(screen.queryByText('Mar 21, 2006')).toBeNull()
	})

	it('renders a Hacker News story card with its metadata and anchor attrs', () => {
		const preview = makeLinkPreview({
			kind: 'hackernews',
			url: 'https://news.ycombinator.com/item?id=1',
			title: 'The Story of the Internet',
			description: 'A concise summary of the story.',
			author_name: 'pg',
			published_at: '2006-10-09',
			extra: { score: 57, comments: 3, domain: 'example.com' },
		})

		render(<LinkPreviewCard preview={preview} />)

		const card = screen.getByTestId('link-preview-hackernews')
		expect(within(card).getByText('Hacker News')).toBeInTheDocument()
		expect(within(card).getByText('example.com')).toBeInTheDocument()
		expect(within(card).getByText('The Story of the Internet')).toBeInTheDocument()
		expect(within(card).getByText('A concise summary of the story.')).toBeInTheDocument()
		expect(
			within(card).getByText('57 points · 3 comments · by pg · Oct 9, 2006')
		).toBeInTheDocument()
		expect(card).toHaveAttribute('href', 'https://news.ycombinator.com/item?id=1')
		expect(card).toHaveAttribute('target', '_blank')
		expect(card).toHaveAttribute('rel', 'noopener noreferrer')
	})

	it('uses singular Hacker News count labels', () => {
		const preview = makeLinkPreview({
			kind: 'hackernews',
			extra: { score: 1, comments: 1 },
		})

		render(<LinkPreviewCard preview={preview} />)

		expect(screen.getByText('1 point · 1 comment')).toBeInTheDocument()
	})

	it('renders a Hacker News comment without an empty title element', () => {
		const preview = makeLinkPreview({
			kind: 'hackernews',
			title: '',
			description: 'This is a comment.',
			author_name: 'sama',
			extra: { is_comment: true },
		})

		render(<LinkPreviewCard preview={preview} />)

		const card = screen.getByTestId('link-preview-hackernews')
		expect(within(card).getByText('Comment by sama')).toBeInTheDocument()
		expect(within(card).getByText('This is a comment.')).toBeInTheDocument()
		expect(within(card).queryByText('A useful linked story')).toBeNull()
	})

	it('renders a Reddit card', () => {
		const preview = makeLinkPreview({
			kind: 'reddit',
			title: 'A useful programming discussion',
			author_name: 'ChemicalRascal',
			extra: { subreddit: 'programming' },
		})

		render(<LinkPreviewCard preview={preview} />)

		const card = screen.getByTestId('link-preview-reddit')
		expect(within(card).getByText('r/programming')).toBeInTheDocument()
		expect(within(card).getByText('Reddit')).toBeInTheDocument()
		expect(within(card).getByText('A useful programming discussion')).toBeInTheDocument()
		expect(within(card).getByText('u/ChemicalRascal')).toBeInTheDocument()
	})

	it('renders a ChatGPT share card', () => {
		const preview = makeLinkPreview({
			kind: 'chatgpt',
			title: 'Planning a weekend project',
			published_at: '2024-12-22',
		})

		render(<LinkPreviewCard preview={preview} />)

		const card = screen.getByTestId('link-preview-chatgpt')
		expect(within(card).getByText('ChatGPT')).toBeInTheDocument()
		expect(within(card).getByText('Planning a weekend project')).toBeInTheDocument()
		expect(within(card).getByText('Shared conversation · Dec 22, 2024')).toBeInTheDocument()
	})
})
