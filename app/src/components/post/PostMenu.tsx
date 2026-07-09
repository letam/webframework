import type React from 'react'
import { useState } from 'react'
import {
	MoreHorizontal,
	Trash2,
	Download,
	Pencil,
	Globe,
	Link2,
	Lock,
	Copy,
	RefreshCw,
	Send,
	Pin,
	PinOff,
} from 'lucide-react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { downloadFile, getFileExtension } from '@/lib/utils/file'
import { getMediaUrl } from '@/lib/api/posts'
import { format } from 'date-fns'
import type { Post, PostVisibility } from '@/types/post'
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
	onPublish?: (id: number) => void
	onChangeVisibility?: (id: number, visibility: PostVisibility) => void
	onPinChange?: (id: number, pinned: boolean) => void
	onCopyShareLink?: (post: Post) => void
	onResetShareLink?: (post: Post) => void
}

const PostMenu: React.FC<PostMenuProps> = ({
	post,
	onDelete,
	onEdit,
	onPublish,
	onChangeVisibility,
	onPinChange,
	onCopyShareLink,
	onResetShareLink,
}) => {
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
	const canPin = isAuthenticated && isOwnPost && !post.is_draft
	const deleteTitle = isOwnPost ? 'Delete Post' : 'Delete Post (Admin Action)'
	const deleteDescription = isOwnPost
		? 'This action cannot be undone. This will permanently delete your post.'
		: `This action cannot be undone. This will permanently delete ${post.author.username}'s post.`

	return (
		<>
			<DropdownMenu>
				<TooltipProvider>
					<Tooltip>
						<DropdownMenuTrigger asChild>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="ml-auto h-8 w-8 text-muted-foreground transition-[color,background-color,opacity,transform] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 md:opacity-0"
									aria-label="Post options"
								>
									<MoreHorizontal className="h-4 w-4" />
								</Button>
							</TooltipTrigger>
						</DropdownMenuTrigger>
						<TooltipContent>More</TooltipContent>
					</Tooltip>
				</TooltipProvider>
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
					{canPin && (
						<DropdownMenuItem onClick={() => onPinChange?.(post.id, !post.pinned_at)}>
							{post.pinned_at ? (
								<PinOff className="mr-2 h-4 w-4" />
							) : (
								<Pin className="mr-2 h-4 w-4" />
							)}
							{post.pinned_at ? 'Unpin from profile' : 'Pin to profile'}
						</DropdownMenuItem>
					)}
					{canEdit && (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>
								{post.visibility === 'private' ? (
									<Lock className="mr-2 h-4 w-4" />
								) : post.visibility === 'unlisted' ? (
									<Link2 className="mr-2 h-4 w-4" />
								) : (
									<Globe className="mr-2 h-4 w-4" />
								)}
								Visibility
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								<DropdownMenuRadioGroup
									value={post.visibility}
									onValueChange={(value) => onChangeVisibility?.(post.id, value as PostVisibility)}
								>
									<DropdownMenuRadioItem value="public">
										<Globe className="mr-2 h-4 w-4" />
										Public
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="unlisted">
										<Link2 className="mr-2 h-4 w-4" />
										Link only
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="private">
										<Lock className="mr-2 h-4 w-4" />
										Private
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					)}
					{canEdit && post.visibility === 'unlisted' && (
						<>
							<DropdownMenuItem onClick={() => onCopyShareLink?.(post)}>
								<Copy className="mr-2 h-4 w-4" />
								Copy share link
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => onResetShareLink?.(post)}>
								<RefreshCw className="mr-2 h-4 w-4" />
								Reset share link
							</DropdownMenuItem>
						</>
					)}
					{canEdit && post.is_draft && (
						<DropdownMenuItem onClick={() => onPublish?.(post.id)}>
							<Send className="mr-2 h-4 w-4" />
							Publish
						</DropdownMenuItem>
					)}
					{(canDelete || canEdit) && <DropdownMenuSeparator />}
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
