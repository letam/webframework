import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioPlayer, VideoPlayer, getWaveformSeekTime } from '@/components/post/MediaPlayer'

describe('MediaPlayer', () => {
	let originalMethods: Array<{
		prototype: typeof HTMLMediaElement.prototype
		load: typeof HTMLMediaElement.prototype.load
		pause: typeof HTMLMediaElement.prototype.pause
		play: typeof HTMLMediaElement.prototype.play
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
			play: prototype.play,
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
			// jsdom does not implement play(); resolve it so togglePlayback runs.
			Object.defineProperty(prototype, 'play', {
				configurable: true,
				value: vi.fn(() => Promise.resolve()),
			})
		}
	})

	beforeEach(() => {
		globalThis.fetch = vi.fn()
	})

	afterAll(() => {
		for (const { prototype, load, pause, play } of originalMethods) {
			Object.defineProperty(prototype, 'load', {
				configurable: true,
				value: load,
			})
			Object.defineProperty(prototype, 'pause', {
				configurable: true,
				value: pause,
			})
			Object.defineProperty(prototype, 'play', {
				configurable: true,
				value: play,
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

	it('streams audio from the URL on play without fetching a blob', async () => {
		const { container } = render(<AudioPlayer audioUrl="/api/posts/1/media/" duration={100} />)

		const audio = container.querySelector('audio') as HTMLAudioElement
		// Controls render SkipBack / Play-Pause / SkipForward; the middle one plays.
		const playButton = container.querySelectorAll('button')[1]

		// play() resolves asynchronously; flush its .then state update inside act.
		await act(async () => {
			fireEvent.click(playButton)
		})

		// Streams from the endpoint — not a downloaded blob: URL — and never fetches.
		expect(audio.src).toContain('/api/posts/1/media/')
		expect(audio.src.startsWith('blob:')).toBe(false)
		expect(globalThis.fetch).not.toHaveBeenCalled()
	})

	it('passes poster and lazy preload attributes to video', () => {
		const { container } = render(
			<VideoPlayer videoUrl="/api/posts/2/media/" thumbnail="/api/posts/2/media/thumbnail/" />
		)

		const video = container.querySelector('video')
		expect(video).toHaveAttribute('poster', '/api/posts/2/media/thumbnail/')
		expect(video).toHaveAttribute('preload', 'none')
	})
})
