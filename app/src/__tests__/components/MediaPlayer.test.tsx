import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioPlayer, VideoPlayer, getWaveformSeekTime } from '@/components/post/MediaPlayer'

describe('MediaPlayer', () => {
	let originalMethods: Array<{
		prototype: typeof HTMLMediaElement.prototype
		load: typeof HTMLMediaElement.prototype.load
		pause: typeof HTMLMediaElement.prototype.pause
	}>

	beforeAll(() => {
		originalMethods = [
			HTMLMediaElement.prototype,
			HTMLAudioElement.prototype,
			HTMLVideoElement.prototype,
		].map((prototype) => ({
			prototype,
			load: prototype.load,
			pause: prototype.pause,
		}))
		for (const { prototype } of originalMethods) {
			Object.defineProperty(prototype, 'load', {
				configurable: true,
				value: vi.fn(),
			})
			Object.defineProperty(prototype, 'pause', {
				configurable: true,
				value: vi.fn(),
			})
		}
	})

	beforeEach(() => {
		globalThis.fetch = vi.fn()
	})

	afterAll(() => {
		for (const { prototype, load, pause } of originalMethods) {
			Object.defineProperty(prototype, 'load', {
				configurable: true,
				value: load,
			})
			Object.defineProperty(prototype, 'pause', {
				configurable: true,
				value: pause,
			})
		}
	})

	it('calculates waveform seek time from click position', () => {
		expect(getWaveformSeekTime(60, 10, 100, 80)).toBe(40)
		expect(getWaveformSeekTime(-10, 10, 100, 80)).toBe(0)
		expect(getWaveformSeekTime(150, 10, 100, 80)).toBe(80)
	})

	it('renders waveform audio without prerendering an audio src', () => {
		const { container } = render(
			<AudioPlayer audioUrl="/api/posts/1/media/" duration={100} waveform={[10, 60, 100, 40]} />
		)

		const audio = container.querySelector('audio')
		expect(audio).not.toHaveAttribute('src')
		expect(audio).toHaveAttribute('preload', 'none')
		expect(globalThis.fetch).not.toHaveBeenCalled()
		expect(screen.getByRole('slider', { name: 'Audio waveform progress' })).toBeInTheDocument()
	})

	it('seeks waveform audio from container pointer position', () => {
		render(
			<AudioPlayer audioUrl="/api/posts/1/media/" duration={100} waveform={[10, 60, 100, 40]} />
		)

		const slider = screen.getByRole('slider', { name: 'Audio waveform progress' })
		slider.getBoundingClientRect = () =>
			({
				left: 10,
				width: 200,
				right: 210,
				top: 0,
				bottom: 48,
				height: 48,
				x: 10,
				y: 0,
				toJSON: () => {},
			}) as DOMRect

		const event = createEvent.pointerDown(slider, { pointerId: 1 })
		Object.defineProperty(event, 'clientX', { value: 110 })
		fireEvent(slider, event)

		expect(slider).toHaveAttribute('aria-valuenow', '50')
	})

	it('passes poster and lazy preload attributes to video', () => {
		const { container } = render(
			<VideoPlayer videoUrl="/api/posts/2/media/" thumbnail="/media/post/2/media/poster.jpg" />
		)

		const video = container.querySelector('video')
		expect(video).toHaveAttribute('poster', '/media/post/2/media/poster.jpg')
		expect(video).toHaveAttribute('preload', 'none')
	})
})
