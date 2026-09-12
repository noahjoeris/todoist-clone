/** Node/tests: no app lifecycle. Metro uses `.native.ts` / `.web.ts` in the app. */
export function subscribeAppForeground(_listener: () => void): () => void {
  return () => {};
}
