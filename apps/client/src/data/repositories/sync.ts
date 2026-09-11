/** The slice of PowerSync status the UI may read. Tokens and SDK types stay in `src/data`. */
export interface ClientSyncStatus {
  connected: boolean;
  connecting: boolean;
  downloading: boolean;
  uploading: boolean;
}

/**
 * Observable sync status plus the upload-queue size used to block sign-out.
 * Subscribe + getStatus fit `useSyncExternalStore`; UI must not import PowerSync.
 */
export interface SyncStatusSource {
  getStatus(): ClientSyncStatus;
  subscribe(listener: () => void): () => void;
  getUploadQueueStats(): Promise<{ count: number }>;
  /**
   * True once this account's local ownership check/clear has finished.
   * Does not wait for PowerSync network connect.
   */
  isLocalDataReadyFor(userId: string): boolean;
}
