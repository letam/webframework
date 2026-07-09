import { format, startOfWeek } from 'date-fns'
import type { Post } from '@/types/post'

export interface PostGroup {
	label: string
	posts: Post[]
}

export type PostGroupMode = 'weeks' | 'months'

export const groupPostsByDate = (posts: Post[], mode: PostGroupMode): PostGroup[] => {
	const groups = new Map<string, PostGroup>()

	for (const post of posts) {
		const date = post.created
		const label =
			mode === 'weeks'
				? `Week of ${format(startOfWeek(date, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
				: format(date, 'MMMM yyyy')

		const existing = groups.get(label)
		if (existing) {
			existing.posts.push(post)
		} else {
			groups.set(label, { label, posts: [post] })
		}
	}

	return Array.from(groups.values())
}
