import { useState, useEffect, useCallback } from 'react'
import type { Post, CreatePostRequest } from '../types/post'
import { getPosts, createPost, deletePost } from '../lib/api/posts'

export const usePosts = () => {
	const [posts, setPosts] = useState<Post[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)

	const fetchPosts = useCallback(async () => {
		try {
			setIsLoading(true)
			const fetchedPosts = await getPosts()
			setPosts(fetchedPosts)
			setError(null)
		} catch (err) {
			setError(err instanceof Error ? err : new Error('Failed to fetch posts'))
		} finally {
			setIsLoading(false)
		}
	}, [])

	const addPost = async (postData: CreatePostRequest) => {
		try {
			const newPost = await createPost(postData)
			setPosts((prevPosts) => [newPost, ...prevPosts])
			return newPost
		} catch (err) {
			setError(err instanceof Error ? err : new Error('Failed to create post'))
			throw err
		}
	}

	const updatePost = (updatedPost: Post) => {
		setPosts((prevPosts) =>
			prevPosts.map((post) => (post.id === updatedPost.id ? updatedPost : post))
		)
	}

	const removePost = async (id: number) => {
		try {
			await deletePost(id)
			setPosts((prevPosts) => prevPosts.filter((post) => post.id !== id))
		} catch (err) {
			setError(err instanceof Error ? err : new Error('Failed to delete post'))
			throw err
		}
	}

	useEffect(() => {
		fetchPosts()
	}, [fetchPosts])

	return {
		posts,
		isLoading,
		error,
		fetchPosts,
		addPost,
		updatePost,
		removePost,
	}
}
