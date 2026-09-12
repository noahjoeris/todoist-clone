/**
 * Dedupes confirmation deep-link deliveries without treating a failed consume as final.
 *
 * Ignore a URL only while it is in-flight or after `onUrl` resolved with a session.
 * Parse-null, throw, and `session == null` clear in-flight so the same string can retry.
 */
export function createAuthDeepLinkHandler(
  onUrl: (url: string) => Promise<boolean>,
): (url: string | null) => Promise<void> {
  let inFlightUrl: string | undefined;
  let lastConsumedUrl: string | undefined;

  return async (url) => {
    if (url == null || url === inFlightUrl || url === lastConsumedUrl) return;
    inFlightUrl = url;
    try {
      const consumed = await onUrl(url);
      if (consumed) lastConsumedUrl = url;
    } catch {
      // Leave unconsumed so a later delivery of the same URL can retry.
    } finally {
      if (inFlightUrl === url) inFlightUrl = undefined;
    }
  };
}
