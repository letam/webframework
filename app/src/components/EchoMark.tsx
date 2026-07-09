import { useId } from 'react'
import { cn } from '@/lib/utils'

interface EchoMarkProps {
	className?: string
	/** Render rings in a single muted color instead of the brand gradient */
	muted?: boolean
}

/**
 * The Echo Sphere brand mark: a sound source with rings rippling outward.
 * Inline SVG so it inherits theme tokens and needs no extra request.
 */
export const EchoMark = ({ className, muted = false }: EchoMarkProps) => {
	const gradientId = useId()
	const stroke = muted ? 'currentColor' : `url(#${gradientId})`

	return (
		<svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn('shrink-0', className)}>
			{!muted && (
				<defs>
					<linearGradient
						id={gradientId}
						x1="4"
						y1="4"
						x2="28"
						y2="28"
						gradientUnits="userSpaceOnUse"
					>
						<stop offset="0" stopColor="hsl(var(--brand-1))" />
						<stop offset="1" stopColor="hsl(var(--brand-2))" />
					</linearGradient>
				</defs>
			)}
			<circle cx="16" cy="16" r="4.5" fill={stroke} />
			<circle cx="16" cy="16" r="9.5" stroke={stroke} strokeWidth="2.25" opacity="0.55" />
			<circle cx="16" cy="16" r="14.5" stroke={stroke} strokeWidth="2.25" opacity="0.22" />
		</svg>
	)
}
