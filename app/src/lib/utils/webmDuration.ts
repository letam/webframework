// webm-duration-fix (and its Node polyfills) is only needed once a recording
// stops, so it is imported dynamically to keep it out of the initial bundle.

type FixWebmDuration = (blob: Blob) => Promise<Blob>

/**
 * Pulls the function out of a dynamic `import('webm-duration-fix')`.
 *
 * The package is CommonJS (`exports.default = fn` plus `__esModule`), and the two
 * toolchains wrap it differently. Vite's dev server honours `__esModule`, so
 * `default` is the function. The production build (Rolldown) uses Node's interop,
 * where `default` is the whole `module.exports` object and the function sits one
 * level down at `default.default`. Destructuring `default` alone worked in dev and
 * threw "t is not a function" in production, which failed every recording.
 */
export const resolveFixWebmDuration = (mod: unknown): FixWebmDuration => {
	const outer = (mod as { default?: unknown } | null)?.default
	if (typeof outer === 'function') return outer as FixWebmDuration
	const inner = (outer as { default?: unknown } | null)?.default
	if (typeof inner === 'function') return inner as FixWebmDuration
	throw new TypeError('webm-duration-fix did not export a function')
}

export const loadFixWebmDuration = async (): Promise<FixWebmDuration> =>
	resolveFixWebmDuration(await import('webm-duration-fix'))

/**
 * Joins a MediaRecorder's chunks into one blob, throwing if the take captured
 * nothing. A zero-byte recording must fail here: the duration fix below is
 * best-effort and passes it through, which would queue or upload empty media.
 */
export const assembleRecording = (chunks: Blob[], type = chunks[0]?.type): Blob => {
	const blob = new Blob(chunks, { type })
	if (blob.size === 0) {
		throw new Error('MediaRecorder produced no data')
	}
	return blob
}

const isWebm = (type: string): boolean => /^(audio|video)\/webm\b/i.test(type)

/**
 * Makes a MediaRecorder WebM seekable by writing its duration into the header.
 *
 * Best-effort: the recording is usable without the fix (the server probes the
 * real duration), so any non-WebM blob (Safari can record `audio/mp4`, which
 * the EBML parser rejects) or a failed fix returns the original blob.
 */
export const fixRecordingDuration = async (blob: Blob): Promise<Blob> => {
	if (!isWebm(blob.type)) return blob
	try {
		const fixWebmDuration = await loadFixWebmDuration()
		return await fixWebmDuration(blob)
	} catch (error) {
		console.error('Could not fix the WebM duration; keeping the original recording:', error)
		return blob
	}
}
