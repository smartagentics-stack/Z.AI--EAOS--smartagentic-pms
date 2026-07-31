export interface StorageEntity { id: string; createdAt: string; updatedAt: string }
export interface StorageRepository<T extends StorageEntity> { findById(id: string): Promise<T | null>; find(filter: Partial<T>): Promise<T[]>; findOne(filter: Partial<T>): Promise<T | null>; create(entity: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>; update(id: string, patch: Partial<Omit<T, 'id' | 'createdAt'>>): Promise<T>; delete(id: string): Promise<void>; count(filter?: Partial<T>): Promise<number> }
export interface StorageClient { getRepository<T extends StorageEntity>(entityName: string): StorageRepository<T>; close(): Promise<void> }
export interface SyncStatus { readonly pendingChanges: number; readonly lastSyncedAt: string | null; readonly isOnline: boolean }
export interface OfflineSyncClient extends StorageClient { queueChange(change: unknown): Promise<void>; sync(): Promise<{ synced: number; conflicts: unknown[]; errors: unknown[] }>; getSyncStatus(): SyncStatus }
