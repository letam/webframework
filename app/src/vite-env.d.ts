/// <reference types="vite/client" />
/// <reference types="@testing-library/jest-dom" />

declare global {
	var __triggerIntersect: (isIntersecting?: boolean, target?: Element) => void
}

export {}
