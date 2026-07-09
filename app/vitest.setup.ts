import '@testing-library/jest-dom'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

type MockObserverRecord = {
	callback: IntersectionObserverCallback
	elements: Set<Element>
	observer: IntersectionObserver
}

const intersectionObservers = new Set<MockObserverRecord>()

class MockResizeObserver implements ResizeObserver {
	observe = () => {}
	unobserve = () => {}
	disconnect = () => {}
}

class MockIntersectionObserver implements IntersectionObserver {
	readonly root: Element | Document | null
	readonly rootMargin: string
	readonly thresholds: ReadonlyArray<number>

	private record: MockObserverRecord

	constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
		this.root = options.root ?? null
		this.rootMargin = options.rootMargin ?? ''
		this.thresholds = Array.isArray(options.threshold)
			? options.threshold
			: [options.threshold ?? 0]
		this.record = {
			callback,
			elements: new Set<Element>(),
			observer: this,
		}
		intersectionObservers.add(this.record)
	}

	observe = (target: Element) => {
		this.record.elements.add(target)
	}

	unobserve = (target: Element) => {
		this.record.elements.delete(target)
	}

	disconnect = () => {
		intersectionObservers.delete(this.record)
		this.record.elements.clear()
	}

	takeRecords = () => []
}

Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	}),
})

Object.defineProperty(window, 'ResizeObserver', {
	writable: true,
	value: MockResizeObserver,
})
Object.defineProperty(globalThis, 'ResizeObserver', {
	writable: true,
	value: MockResizeObserver,
})

Object.defineProperty(window, 'IntersectionObserver', {
	writable: true,
	value: MockIntersectionObserver,
})
Object.defineProperty(globalThis, 'IntersectionObserver', {
	writable: true,
	value: MockIntersectionObserver,
})

Object.defineProperty(window, 'MediaRecorder', {
	writable: true,
	value: { isTypeSupported: () => true },
})
Object.defineProperty(globalThis, 'MediaRecorder', {
	writable: true,
	value: { isTypeSupported: () => true },
})

Object.defineProperty(globalThis, '__triggerIntersect', {
	writable: true,
	value: (isIntersecting = true, target?: Element) => {
		for (const { callback, elements, observer } of intersectionObservers) {
			const targets = target ? [target] : Array.from(elements)
			const entries = targets
				.filter((element) => elements.has(element))
				.map((element) => {
					const rect = element.getBoundingClientRect()
					return {
						boundingClientRect: rect,
						intersectionRatio: isIntersecting ? 1 : 0,
						intersectionRect: rect,
						isIntersecting,
						rootBounds: null,
						target: element,
						time: performance.now(),
					} as IntersectionObserverEntry
				})

			if (entries.length > 0) {
				callback(entries, observer)
			}
		}
	},
})

// Automatically cleanup after each test
afterEach(() => {
	cleanup()
	intersectionObservers.clear()
})

declare global {
	var __triggerIntersect: (isIntersecting?: boolean, target?: Element) => void
}
