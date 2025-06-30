import type React from 'react'
import { useState } from 'react'
import { MoreHorizontal, Trash2, Download, Pencil } from 'lucide-react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { downloadFile, getFileExtension } from '@/lib/utils/file'
import { getMediaUrl } from '@/lib/api/posts'
import { format } from 'date-fns'
import type { Post } from '@/types/post'
import { useAuth } from '@/hooks/useAuth'
import { EditPostModal } from './EditPostModal'
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog'

interface PostMenuProps {
	post: Post
	onDelete: (id: number) => void
	onEdit: (
		id: number,
		head: string,
		body: string,
		transcript?: string,
		altText?: string
	) => Promise<void>
}

const PostMenu: React.FC<PostMenuProps> = ({ post, onDelete, onEdit }) => {
	const { isAuthenticated, userId, isSuperuser } = useAuth()
	const canDelete = isAuthenticated && (userId === post.author.id || isSuperuser)
	const canEdit = isAuthenticated && (userId === post.author.id || isSuperuser)
	const [isEditModalOpen, setIsEditModalOpen] = useState(false)
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

	const handleDelete = () => {
		setIsDeleteDialogOpen(true)
	}

	const handleConfirmDelete = () => {
		onDelete(post.id)
		setIsDeleteDialogOpen(false)
	}

	const handleEdit = () => {
		setIsEditModalOpen(true)
	}

	const handleDownload = () => {
		if (post.media) {
			const formattedDateTime = format(post.created, 'yyyy-MM-dd_HH-mm-ss')
			const mediaFileExtension = getFileExtension(post.media.file || post.media.s3_file_key)
			const filename = `${post.author.username}_${formattedDateTime}.${mediaFileExtension}`

			downloadFile({ url: getMediaUrl(post), filename })
		}
	}

	const isOwnPost = userId === post.author.id
	const deleteTitle = isOwnPost ? 'Delete Post' : 'Delete Post (Admin Action)'
	const deleteDescription = isOwnPost
		? 'This action cannot be undone. This will permanently delete your post.'
		: `This action cannot be undone. This will permanently delete ${post.author.username}'s post.`

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" className="ml-auto h-8 w-8">
						<MoreHorizontal className="h-4 w-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{post.media && (
						<DropdownMenuItem onClick={handleDownload}>
							<Download className="mr-2 h-4 w-4" />
							Download
						</DropdownMenuItem>
					)}
					{canEdit && (
						<DropdownMenuItem onClick={handleEdit}>
							<Pencil className="mr-2 h-4 w-4" />
							Edit
						</DropdownMenuItem>
					)}
					{canDelete && (
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onClick={handleDelete}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<EditPostModal
				post={post}
				open={isEditModalOpen}
				onOpenChange={setIsEditModalOpen}
				onSave={onEdit}
			/>

			<DeleteConfirmationDialog
				open={isDeleteDialogOpen}
				onOpenChange={setIsDeleteDialogOpen}
				onConfirm={handleConfirmDelete}
				title={deleteTitle}
				description={deleteDescription}
			/>
		</>
	)
}

export default PostMenu
