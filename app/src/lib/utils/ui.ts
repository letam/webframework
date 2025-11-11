export const scrollToElement = (element: HTMLElement) => {
	if (typeof window === 'undefined') {
		console.error('window is not defined, cannot scroll to element')
		return
	}
	if (!element) {
		console.error('element is not defined, cannot scroll to element')
		return
	}
	const offsetForHeader = document.getElementsByTagName('header')[0].clientHeight + 16
	const { top } = element.getBoundingClientRect()
	window.scrollTo({ top: top + window.scrollY - offsetForHeader, behavior: 'smooth' })
}
