import type React from 'react'
import { Button } from '@/components/ui/button'

interface TextPostTabProps {
	onSubmit: (e: React.MouseEvent) => void
}

const TextPostTab: React.FC<TextPostTabProps> = ({ onSubmit }) => {
	return (
		<div className="flex justify-end">
			<Button type="button" onClick={onSubmit}>
				Post
			</Button>
		</div>
	)
}

export default TextPostTab
