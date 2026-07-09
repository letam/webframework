/**
 * Every user gets a stable hue derived from their username, used for avatar
 * fallbacks and profile banners so identities are recognizable at a glance.
 */
export const identityHue = (seed: string): number => {
	let hash = 0
	for (let i = 0; i < seed.length; i++) {
		hash = (hash << 5) - hash + seed.charCodeAt(i)
		hash |= 0
	}
	return Math.abs(hash) % 360
}

/** Diagonal two-stop gradient anchored on the user's identity hue. */
export const identityGradient = (seed: string): string => {
	const hue = identityHue(seed)
	return `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 50) % 360} 68% 44%))`
}
