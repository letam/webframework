import type { PostVisibility } from '@/types/post'

const DB_NAME = 'post-outbox'
const STORE = 'entries'

export type OutboxAuthor = number | 'anon' | 'unknown'
export type OutboxStatus = 'queued' | 'sending' | 'failed' | 'published' | 'cancelled'

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
	/** Present only while a tab owns an active send lease. */
	claimOwner?: string | null
	claimExpiresAt?: number | null
}

export const OUTBOX_CLAIM_LEASE_MS = 5 * 60_000

const recoverExpiredClaim = (entry: OutboxEntry, now: number): OutboxEntry =>
	entry.status === 'sending' && (!entry.claimExpiresAt || entry.claimExpiresAt <= now)
		? { ...entry, status: 'queued', claimOwner: null, claimExpiresAt: null }
		: entry

export type ClaimOutboxEntryResult =
	| { status: 'claimed'; entry: OutboxEntry }
	| { status: 'missing' }
	| { status: 'not-queued'; entry: OutboxEntry }
	| { status: 'unavailable' }

export type InspectOutboxEntryResult =
	| { status: 'found'; entry: OutboxEntry }
	| { status: 'missing' }
	| { status: 'unavailable' }

export type CancelOutboxEntryResult =
	| { status: 'cancelled'; entry: OutboxEntry }
	| { status: 'missing' }
	| { status: 'unavailable' }

export type DeleteCancelledOutboxEntryResult =
	| { status: 'removed' | 'missing' }
	| { status: 'conflict'; entry: OutboxEntry }
	| { status: 'unavailable' }

export type ResetOutboxEntryResult =
	| { status: 'reset'; entry: OutboxEntry }
	| { status: 'missing' }
	| { status: 'conflict'; entry: OutboxEntry }
	| { status: 'unavailable' }

export type OwnedOutboxClaimResult =
	| { status: 'updated'; entry: OutboxEntry }
	| { status: 'removed' | 'missing' }
	| { status: 'lost'; entry: OutboxEntry }
	| { status: 'unavailable' }

export type LoadOutboxEntriesResult =
	| { status: 'loaded'; entries: OutboxEntry[] }
	| { status: 'unavailable' }

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

export const inspectOutboxEntry = async (id: string): Promise<InspectOutboxEntryResult> => {
	const db = await openDb()
	if (!db) return { status: 'unavailable' }

	try {
		return await new Promise<InspectOutboxEntryResult>((resolve) => {
			let transaction: IDBTransaction
			let result: InspectOutboxEntryResult = { status: 'unavailable' }
			try {
				transaction = db.transaction(STORE, 'readwrite')
				const store = transaction.objectStore(STORE)
				const request = store.get(id)
				request.onsuccess = () => {
					const stored = request.result as OutboxEntry | undefined
					if (!stored) {
						result = { status: 'missing' }
						return
					}
					const recovered = recoverExpiredClaim(stored, Date.now())
					if (recovered !== stored) store.put(recovered)
					result = { status: 'found', entry: recovered }
				}
				request.onerror = () => transaction.abort()
			} catch {
				resolve({ status: 'unavailable' })
				return
			}
			transaction.oncomplete = () => resolve(result)
			transaction.onerror = () => resolve({ status: 'unavailable' })
			transaction.onabort = () => resolve({ status: 'unavailable' })
		})
	} finally {
		db.close()
	}
}

export const claimOutboxEntryForSend = async (
	id: string,
	owner: string
): Promise<ClaimOutboxEntryResult> => {
	const db = await openDb()
	if (!db) return { status: 'unavailable' }

	try {
		return await new Promise<ClaimOutboxEntryResult>((resolve) => {
			let transaction: IDBTransaction
			let result: ClaimOutboxEntryResult = { status: 'unavailable' }
			try {
				transaction = db.transaction(STORE, 'readwrite')
				const store = transaction.objectStore(STORE)
				const request = store.get(id)
				request.onsuccess = () => {
					const stored = request.result as OutboxEntry | undefined
					const entry = stored ? recoverExpiredClaim(stored, Date.now()) : undefined
					if (!entry) {
						result = { status: 'missing' }
						return
					}
					if (entry.status !== 'queued') {
						result = { status: 'not-queued', entry }
						return
					}
					const claimed = {
						...entry,
						status: 'sending' as const,
						lastError: null,
					}
					claimed.claimOwner = owner
					claimed.claimExpiresAt = Date.now() + OUTBOX_CLAIM_LEASE_MS
					const putRequest = store.put(claimed)
					putRequest.onsuccess = () => {
						result = { status: 'claimed', entry: claimed }
					}
				}
				request.onerror = () => transaction.abort()
			} catch {
				resolve({ status: 'unavailable' })
				return
			}

			transaction.oncomplete = () => resolve(result)
			transaction.onerror = () => resolve({ status: 'unavailable' })
			transaction.onabort = () => resolve({ status: 'unavailable' })
		})
	} finally {
		db.close()
	}
}

export const renewOutboxEntryClaim = async (id: string, owner: string): Promise<boolean> => {
	const db = await openDb()
	if (!db) return false

	try {
		return await new Promise<boolean>((resolve) => {
			let transaction: IDBTransaction
			let renewed = false
			try {
				transaction = db.transaction(STORE, 'readwrite')
				const store = transaction.objectStore(STORE)
				const request = store.get(id)
				request.onsuccess = () => {
					const entry = request.result as OutboxEntry | undefined
					if (entry?.status !== 'sending' || entry.claimOwner !== owner) return
					store.put({ ...entry, claimExpiresAt: Date.now() + OUTBOX_CLAIM_LEASE_MS })
					renewed = true
				}
				request.onerror = () => transaction.abort()
			} catch {
				resolve(false)
				return
			}
			transaction.oncomplete = () => resolve(renewed)
			transaction.onerror = () => resolve(false)
			transaction.onabort = () => resolve(false)
		})
	} finally {
		db.close()
	}
}

export const resetFailedOutboxEntryForRetry = async (
	id: string
): Promise<ResetOutboxEntryResult> => {
	const db = await openDb()
	if (!db) return { status: 'unavailable' }

	try {
		return await new Promise<ResetOutboxEntryResult>((resolve) => {
			let transaction: IDBTransaction
			let result: ResetOutboxEntryResult = { status: 'unavailable' }
			try {
				transaction = db.transaction(STORE, 'readwrite')
				const store = transaction.objectStore(STORE)
				const request = store.get(id)
				request.onsuccess = () => {
					const entry = request.result as OutboxEntry | undefined
					if (!entry) {
						result = { status: 'missing' }
						return
					}
					if (entry.status !== 'failed') {
						result = { status: 'conflict', entry }
						return
					}
					const reset = {
						...entry,
						status: 'queued' as const,
						attempts: 0,
						lastError: null,
						claimOwner: null,
						claimExpiresAt: null,
					}
					const putRequest = store.put(reset)
					putRequest.onsuccess = () => {
						result = { status: 'reset', entry: reset }
					}
				}
				request.onerror = () => transaction.abort()
			} catch {
				resolve({ status: 'unavailable' })
				return
			}
			transaction.oncomplete = () => resolve(result)
			transaction.onerror = () => resolve({ status: 'unavailable' })
			transaction.onabort = () => resolve({ status: 'unavailable' })
		})
	} finally {
		db.close()
	}
}

export const updateOwnedOutboxEntryClaim = async (
	id: string,
	owner: string,
	changes: Partial<OutboxEntry>
): Promise<OwnedOutboxClaimResult> => {
	const db = await openDb()
	if (!db) return { status: 'unavailable' }

	try {
		return await new Promise<OwnedOutboxClaimResult>((resolve) => {
			let transaction: IDBTransaction
			let result: OwnedOutboxClaimResult = { status: 'unavailable' }
			try {
				transaction = db.transaction(STORE, 'readwrite')
				const store = transaction.objectStore(STORE)
				const request = store.get(id)
				request.onsuccess = () => {
					const entry = request.result as OutboxEntry | undefined
					if (!entry) {
						result = { status: 'missing' }
						return
					}
					if (entry.status !== 'sending' || entry.claimOwner !== owner) {
						result = { status: 'lost', entry }
						return
					}
					const updated = {
						...entry,
						...changes,
						...(changes.status && changes.status !== 'sending'
							? { claimOwner: null, claimExpiresAt: null }
							: {}),
					}
					const putRequest = store.put(updated)
					putRequest.onsuccess = () => {
						result = { status: 'updated', entry: updated }
					}
				}
				request.onerror = () => transaction.abort()
			} catch {
				resolve({ status: 'unavailable' })
				return
			}
			transaction.oncomplete = () => resolve(result)
			transaction.onerror = () => resolve({ status: 'unavailable' })
			transaction.onabort = () => resolve({ status: 'unavailable' })
		})
	} finally {
		db.close()
	}
}

export const deleteOwnedOutboxEntryClaim = async (
	id: string,
	owner: string
): Promise<OwnedOutboxClaimResult> => {
	const db = await openDb()
	if (!db) return { status: 'unavailable' }

	try {
		return await new Promise<OwnedOutboxClaimResult>((resolve) => {
			let transaction: IDBTransaction
			let result: OwnedOutboxClaimResult = { status: 'unavailable' }
			try {
				transaction = db.transaction(STORE, 'readwrite')
				const store = transaction.objectStore(STORE)
				const request = store.get(id)
				request.onsuccess = () => {
					const entry = request.result as OutboxEntry | undefined
					if (!entry) {
						result = { status: 'missing' }
						return
					}
					if (entry.status !== 'sending' || entry.claimOwner !== owner) {
						result = { status: 'lost', entry }
						return
					}
					const deleteRequest = store.delete(id)
					deleteRequest.onsuccess = () => {
						result = { status: 'removed' }
					}
				}
				request.onerror = () => transaction.abort()
			} catch {
				resolve({ status: 'unavailable' })
				return
			}
			transaction.oncomplete = () => resolve(result)
			transaction.onerror = () => resolve({ status: 'unavailable' })
			transaction.onabort = () => resolve({ status: 'unavailable' })
		})
	} finally {
		db.close()
	}
}

export const cancelOutboxEntry = async (
	id: string,
	fallback?: OutboxEntry
): Promise<CancelOutboxEntryResult> => {
	const db = await openDb()
	if (!db) return { status: 'unavailable' }

	try {
		return await new Promise<CancelOutboxEntryResult>((resolve) => {
			let transaction: IDBTransaction
			let result: CancelOutboxEntryResult = { status: 'unavailable' }
			try {
				transaction = db.transaction(STORE, 'readwrite')
				const store = transaction.objectStore(STORE)
				const request = store.get(id)
				request.onsuccess = () => {
					const entry = (request.result as OutboxEntry | undefined) ?? fallback
					if (!entry) {
						result = { status: 'missing' }
						return
					}
					const cancelled = {
						...entry,
						status: 'cancelled' as const,
						lastError: null,
						claimOwner: null,
						claimExpiresAt: null,
					}
					const putRequest = store.put(cancelled)
					putRequest.onsuccess = () => {
						result = { status: 'cancelled', entry: cancelled }
					}
				}
				request.onerror = () => transaction.abort()
			} catch {
				resolve({ status: 'unavailable' })
				return
			}
			transaction.oncomplete = () => resolve(result)
			transaction.onerror = () => resolve({ status: 'unavailable' })
			transaction.onabort = () => resolve({ status: 'unavailable' })
		})
	} finally {
		db.close()
	}
}

export const deleteCancelledOutboxEntry = async (
	id: string
): Promise<DeleteCancelledOutboxEntryResult> => {
	const db = await openDb()
	if (!db) return { status: 'unavailable' }

	try {
		return await new Promise<DeleteCancelledOutboxEntryResult>((resolve) => {
			let transaction: IDBTransaction
			let result: DeleteCancelledOutboxEntryResult = { status: 'unavailable' }
			try {
				transaction = db.transaction(STORE, 'readwrite')
				const store = transaction.objectStore(STORE)
				const request = store.get(id)
				request.onsuccess = () => {
					const entry = request.result as OutboxEntry | undefined
					if (!entry) {
						result = { status: 'missing' }
						return
					}
					if (entry.status !== 'cancelled') {
						result = { status: 'conflict', entry }
						return
					}
					const deleteRequest = store.delete(id)
					deleteRequest.onsuccess = () => {
						result = { status: 'removed' }
					}
				}
				request.onerror = () => transaction.abort()
			} catch {
				resolve({ status: 'unavailable' })
				return
			}
			transaction.oncomplete = () => resolve(result)
			transaction.onerror = () => resolve({ status: 'unavailable' })
			transaction.onabort = () => resolve({ status: 'unavailable' })
		})
	} finally {
		db.close()
	}
}

export const loadOutboxEntries = async (): Promise<LoadOutboxEntriesResult> => {
	const db = await openDb()
	if (!db) return { status: 'unavailable' }

	try {
		return await new Promise<LoadOutboxEntriesResult>((resolve) => {
			let entries: OutboxEntry[] = []
			let transaction: IDBTransaction
			try {
				transaction = db.transaction(STORE, 'readwrite')
				const store = transaction.objectStore(STORE)
				const request = store.getAll()
				request.onsuccess = () => {
					entries = (request.result as OutboxEntry[]).map((entry) => {
						const recovered = recoverExpiredClaim(entry, Date.now())
						if (recovered !== entry) store.put(recovered)
						return recovered
					})
				}
				request.onerror = () => transaction.abort()
			} catch {
				resolve({ status: 'unavailable' })
				return
			}

			transaction.oncomplete = () =>
				resolve({ status: 'loaded', entries: entries.sort((a, b) => a.createdAt - b.createdAt) })
			transaction.onerror = () => resolve({ status: 'unavailable' })
			transaction.onabort = () => resolve({ status: 'unavailable' })
		})
	} finally {
		db.close()
	}
}
