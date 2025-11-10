import type { Post } from '../types/post'
import type { TagInfo } from '../types/tag'

const HASHTAG_REGEX = /#[0-9A-Za-z_]+/g

const extractHashtags = (text?: string) => {
	if (!text) {
		return []
	}

	const matches = text.match(HASHTAG_REGEX)

	if (!matches) {
		return []
	}

	return matches.map((match) => match.slice(1).trim()).filter((tag) => tag.length > 0)
}

export const buildTagIndex = (posts: Post[]): TagInfo[] => {
	const counts = new Map<string, TagInfo>()

	for (const post of posts) {
		const fields = [post.head, post.body]

		for (const field of fields) {
			const hashtags = extractHashtags(field)

			for (const hashtag of hashtags) {
				const key = hashtag.toLowerCase()
				const existing = counts.get(key)

				if (existing) {
					existing.count += 1
					continue
				}

				counts.set(key, {
					tag: hashtag,
					count: 1,
				})
			}
		}
	}

	return Array.from(counts.values()).sort((a, b) => {
		if (a.count === b.count) {
			return a.tag.localeCompare(b.tag)
		}

		return b.count - a.count
	})
}
