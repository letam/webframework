import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PostActions from '@/components/post/PostActions'
import { makePost } from '../data/mockPosts'

const renderPostActions = (post = makePost()) =>
	render(
		<PostActions
			post={post}
			likeCount={post.like_count}
			liked={post.liked}
			onLike={vi.fn()}
			commentCount={post.comment_count}
			commentsOpen={false}
			onToggleComments={vi.fn()}
			body={post.body}
		/>
	)

describe('PostActions', () => {
	it('renders a passive view count when the published post has views', () => {
		renderPostActions(makePost({ view_count: 7 }))

		expect(screen.getByTitle('7 views')).toBeInTheDocument()
	})

	it('hides the view count at zero', () => {
		renderPostActions(makePost({ view_count: 0 }))

		expect(screen.queryByTitle('0 views')).not.toBeInTheDocument()
	})

	it('hides the view count on drafts', () => {
		renderPostActions(makePost({ is_draft: true, view_count: 4 }))

		expect(screen.queryByTitle('4 views')).not.toBeInTheDocument()
	})
})
