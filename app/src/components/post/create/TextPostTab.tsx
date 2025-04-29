import type React from 'react'
import { Button } from '@/components/ui/button'

interface TextPostTabProps {
	onSubmit: () => void
}

const TextPostTab: React.FC<TextPostTabProps> = ({ onSubmit }) => {
	return (
		<div className="flex justify-end">
			<Button type="submit" onClick={onSubmit}>
				Post
			</Button>
		</div>
	)
}

export default TextPostTab
