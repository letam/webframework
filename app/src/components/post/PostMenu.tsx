import type React from 'react'
import { MoreHorizontal, Trash2, Download } from 'lucide-react'
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

interface PostMenuProps {
	post: Post
	onDelete: (id: number) => void
}

const PostMenu: React.FC<PostMenuProps> = ({ post, onDelete }) => {
	const handleDelete = () => {
		onDelete(post.id)
	}

	const handleDownload = () => {
		if (post.media) {
			const formattedDateTime = format(post.created, 'yyyy-MM-dd_HH-mm-ss')
			const mediaFileExtension = getFileExtension(post.media.file || post.media.s3_file_key)
			const filename = `${post.author.username}_${formattedDateTime}.${mediaFileExtension}`

			downloadFile({ url: getMediaUrl(post), filename })
		}
	}

	return (
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
				<DropdownMenuItem
					className="text-destructive focus:text-destructive"
					onClick={handleDelete}
				>
					<Trash2 className="mr-2 h-4 w-4" />
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

export default PostMenu
