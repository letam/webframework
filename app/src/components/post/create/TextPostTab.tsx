import type React from 'react'
import { Button } from '@/components/ui/button'

interface TextPostTabProps {
	onSubmit: (e: React.MouseEvent) => void
	disabled?: boolean
}

const TextPostTab: React.FC<TextPostTabProps> = ({ onSubmit, disabled }) => {
	return (
		<div className="flex justify-end">
			<Button type="button" onClick={onSubmit} disabled={disabled}>
				Post
			</Button>
		</div>
	)
}

export default TextPostTab
