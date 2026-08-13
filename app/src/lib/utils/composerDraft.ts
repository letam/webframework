// Local autosave for the composer.
//
// Everything else in the composer can be retyped; a recording cannot. Between
// pressing stop and pressing Post, an audio or video take exists only as a Blob
// in this tab's memory, so a refresh, an incoming call, or iOS evicting a
// backgrounded tab destroys it. This keeps the in-progress post on disk and
// hands it back on the next mount.
//
// IndexedDB rather than localStorage: localStorage stores strings only, so a
// Blob would have to be base64'd (+33%) into a ~5 MB origin budget that a few
// seconds of video already blows past. IndexedDB stores Blobs natively and its
// quota is measured in hundreds of MB.
//
// Every operation degrades to a no-op rather than throwing. Private-mode
// browsers, disabled storage, and a failed upgrade all end with the composer
// working exactly as it did before autosave existed — losing a draft is bad,
// but breaking the composer over it is worse.

import type { PostVisibility } from '@/types/post'

const DB_NAME = 'composer-drafts'
const STORE = 'drafts'

/** Drafts older than this are discarded on load rather than restored. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type ComposerMediaType = 'text' | 'audio' | 'video' | 'image'

export interface ComposerDraft {
	text: string
	visibility: PostVisibility
	mediaType: ComposerMediaType
	media: Blob | null
	/** Original filename, since a Blob does not carry one. */
	mediaName: string | null
	/** Whether the media came from a file input (a File) or a recorder (a Blob). */
	mediaIsFile: boolean
	/** True when the media exceeded the storage quota and only the text was kept. */
	mediaOmitted: boolean
	savedAt: number
}

/**
 * Storage key for a signed-in user, or for the anonymous session.
 *
 * Drafts are keyed per user so that signing out, or switching accounts on a
 * shared device, never hands one person's unposted words to another.
 */
export const draftKeyForUser = (userId: number | null): string =>
	userId === null ? 'anon' : `user:${userId}`

/**
 * Open the database, creating the object store if it is missing.
 *
 * Opened without a fixed version on purpose. Pinning one means that a database
 * which already exists at that version but has no object store — a half-applied
 * upgrade, or another writer that created it differently — never fires
 * `onupgradeneeded`, so the store is never built and every write afterwards
 * fails silently. Opening at the current version and bumping only when the
 * store is actually absent repairs that instead of inheriting it.
 */
const openDb = (): Promise<IDBDatabase | null> =>
	new Promise((resolve) => {
		if (typeof indexedDB === 'undefined') {
			resolve(null)
			return
		}

		const attempt = (version?: number) => {
			let request: IDBOpenDBRequest
			try {
				request = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version)
			} catch {
				// Safari throws outright rather than erroring the request when
				// storage is unavailable to the origin.
				resolve(null)
				return
			}

			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(STORE)) {
					request.result.createObjectStore(STORE)
				}
			}
			request.onsuccess = () => {
				const db = request.result
				if (db.objectStoreNames.contains(STORE)) {
					resolve(db)
					return
				}
				db.close()
				// One repair attempt only; a second failure means something is
				// wrong that retrying will not fix.
				if (version !== undefined) {
					resolve(null)
					return
				}
				attempt(db.version + 1)
			}
			request.onerror = () => resolve(null)
			// A blocked open means another tab holds an older version open. Give up
			// rather than wait: the composer must not depend on this resolving.
			request.onblocked = () => resolve(null)
		}

		attempt()
	})

/** Run one request against the store, resolving null on any failure. */
const withStore = async <T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest
): Promise<T | null> => {
	const db = await openDb()
	if (!db) return null

	try {
		return await new Promise<T | null>((resolve) => {
			let request: IDBRequest
			try {
				request = run(db.transaction(STORE, mode).objectStore(STORE))
			} catch {
				resolve(null)
				return
			}
			request.onsuccess = () => resolve(request.result as T)
			request.onerror = () => resolve(null)
			request.transaction?.addEventListener('abort', () => resolve(null))
		})
	} finally {
		db.close()
	}
}

/**
 * Read the stored draft for a user, discarding it if it has gone stale.
 *
 * Returns null when there is nothing to restore, when storage is unavailable,
 * or when the record predates {@link DRAFT_MAX_AGE_MS} — a month-old fragment
 * reappearing in the composer reads as a bug, not a rescue.
 */
export const loadComposerDraft = async (userId: number | null): Promise<ComposerDraft | null> => {
	const key = draftKeyForUser(userId)
	const record = await withStore<ComposerDraft | undefined>('readonly', (store) => store.get(key))
	if (!record) return null

	if (!Number.isFinite(record.savedAt) || Date.now() - record.savedAt > DRAFT_MAX_AGE_MS) {
		await clearComposerDraft(userId)
		return null
	}
	return record
}

/**
 * Persist the draft, falling back to a text-only record if the media will not fit.
 *
 * A large video is exactly the content most worth saving and the most likely to
 * exceed quota, so a rejected write retries without it: keeping the words and
 * losing the take beats losing both silently.
 */
export const saveComposerDraft = async (
	userId: number | null,
	draft: Omit<ComposerDraft, 'savedAt' | 'mediaOmitted'>
): Promise<void> => {
	const key = draftKeyForUser(userId)
	const db = await openDb()
	if (!db) return

	const put = (record: ComposerDraft): Promise<boolean> =>
		new Promise((resolve) => {
			let request: IDBRequest
			try {
				request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, key)
			} catch {
				resolve(false)
				return
			}
			request.onsuccess = () => resolve(true)
			// A quota failure lands here; the caller retries without the media.
			request.onerror = () => resolve(false)
			request.transaction?.addEventListener('abort', () => resolve(false))
		})

	try {
		const stored = await put({ ...draft, mediaOmitted: false, savedAt: Date.now() })
		if (!stored && draft.media) {
			await put({
				...draft,
				media: null,
				mediaName: null,
				mediaOmitted: true,
				savedAt: Date.now(),
			})
		}
	} finally {
		db.close()
	}
}

/**
 * Update only the text fields of the stored draft, reusing the stored media Blob.
 *
 * Typing a caption on a large recording must not re-serialize the take on every
 * keystroke. This reads the current record and writes it back with new text,
 * keeping the persisted Blob by reference — the in-memory 40 MB video is never
 * re-copied to disk. If no record exists yet (storage unavailable, or the media
 * write has not landed), it degrades to a text-only put.
 */
export const updateComposerDraftFields = async (
	userId: number | null,
	fields: Pick<ComposerDraft, 'text' | 'visibility' | 'mediaType'>
): Promise<void> => {
	const key = draftKeyForUser(userId)
	const db = await openDb()
	if (!db) return

	try {
		await new Promise<void>((resolve) => {
			let tx: IDBTransaction
			try {
				tx = db.transaction(STORE, 'readwrite')
			} catch {
				resolve()
				return
			}
			const store = tx.objectStore(STORE)
			const getRequest = store.get(key)
			getRequest.onsuccess = () => {
				const existing = getRequest.result as ComposerDraft | undefined
				const record: ComposerDraft = existing
					? { ...existing, ...fields, savedAt: Date.now() }
					: {
							...fields,
							media: null,
							mediaName: null,
							mediaIsFile: false,
							mediaOmitted: false,
							savedAt: Date.now(),
						}
				store.put(record, key)
			}
			tx.oncomplete = () => resolve()
			tx.onerror = () => resolve()
			tx.onabort = () => resolve()
		})
	} finally {
		db.close()
	}
}

/** Drop the stored draft. Called on a successful post and on explicit discard. */
export const clearComposerDraft = async (userId: number | null): Promise<void> => {
	const key = draftKeyForUser(userId)
	await withStore('readwrite', (store) => store.delete(key))
}
