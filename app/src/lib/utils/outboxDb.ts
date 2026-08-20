import type { PostVisibility } from '@/types/post'

const DB_NAME = 'post-outbox'
const STORE = 'entries'

export type OutboxAuthor = number | 'anon' | 'unknown'
export type OutboxStatus = 'queued' | 'sending' | 'failed'

export interface OutboxEntry {
	id: string
	createdAt: number
	author: OutboxAuthor
	status: OutboxStatus
	attempts: number
	lastError: string | null
	text: string
	visibility: PostVisibility | null
	isDraft: boolean
	linkPreviewsEnabled: boolean
	autoTranscribe: boolean
	mediaType: 'audio' | 'video' | 'image' | null
	media: Blob | null
	mediaName: string | null
}

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
				resolve(null)
				return
			}

			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(STORE)) {
					request.result.createObjectStore(STORE, { keyPath: 'id' })
				}
			}
			request.onsuccess = () => {
				const db = request.result
				if (db.objectStoreNames.contains(STORE)) {
					resolve(db)
					return
				}
				db.close()
				if (version !== undefined) {
					resolve(null)
					return
				}
				attempt(db.version + 1)
			}
			request.onerror = () => resolve(null)
			request.onblocked = () => resolve(null)
		}

		attempt()
	})

const runRequest = async <T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> => {
	const db = await openDb()
	if (!db) return null

	try {
		return await new Promise<T | null>((resolve) => {
			let transaction: IDBTransaction
			let request: IDBRequest<T>
			try {
				transaction = db.transaction(STORE, mode)
				request = run(transaction.objectStore(STORE))
			} catch {
				resolve(null)
				return
			}
			let result: T
			request.onsuccess = () => {
				result = request.result
			}
			request.onerror = () => resolve(null)
			transaction.oncomplete = () => resolve(result)
			transaction.onerror = () => resolve(null)
			transaction.onabort = () => resolve(null)
		})
	} finally {
		db.close()
	}
}

export const saveOutboxEntry = async (entry: OutboxEntry): Promise<boolean> =>
	(await runRequest<IDBValidKey>('readwrite', (store) => store.put(entry))) !== null

export const getOutboxEntry = async (id: string): Promise<OutboxEntry | null> =>
	(await runRequest<OutboxEntry | undefined>('readonly', (store) => store.get(id))) ?? null

export const deleteOutboxEntry = async (id: string): Promise<boolean> =>
	(await runRequest<undefined>('readwrite', (store) => store.delete(id))) !== null

export const loadOutboxEntries = async (): Promise<OutboxEntry[]> => {
	const db = await openDb()
	if (!db) return []

	try {
		return await new Promise<OutboxEntry[]>((resolve) => {
			let entries: OutboxEntry[] = []
			let transaction: IDBTransaction
			try {
				transaction = db.transaction(STORE, 'readwrite')
				const store = transaction.objectStore(STORE)
				const request = store.getAll()
				request.onsuccess = () => {
					entries = (request.result as OutboxEntry[]).map((entry) => {
						if (entry.status !== 'sending') return entry
						const recovered = { ...entry, status: 'queued' as const }
						store.put(recovered)
						return recovered
					})
				}
				request.onerror = () => resolve([])
			} catch {
				resolve([])
				return
			}

			transaction.oncomplete = () => resolve(entries.sort((a, b) => a.createdAt - b.createdAt))
			transaction.onerror = () => resolve([])
			transaction.onabort = () => resolve([])
		})
	} finally {
		db.close()
	}
}
