/** Fail closed: the queue size is unknown until a successful `getUploadQueueStats`. */
export type UploadQueueCount = { status: 'unknown' } | { status: 'ready'; count: number };

export type SignOutAvailability =
  | { action: 'checking' }
  | { action: 'wait'; count: number }
  | { action: 'sign-out' };

export function signOutAvailability(queue: UploadQueueCount): SignOutAvailability {
  if (queue.status === 'unknown') return { action: 'checking' };
  if (queue.count > 0) return { action: 'wait', count: queue.count };
  return { action: 'sign-out' };
}
