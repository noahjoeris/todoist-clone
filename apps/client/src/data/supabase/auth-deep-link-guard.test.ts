import { describe, expect, it, vi } from 'vitest';
import { createAuthDeepLinkHandler } from './auth-deep-link-guard';

const url = 'todoist-clone://auth/callback?code=pkce-code';
const otherUrl = 'todoist-clone://auth/callback?code=other';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createAuthDeepLinkHandler', () => {
  it('ignores null and a duplicate URL while consume is in flight', async () => {
    const pending = deferred<boolean>();
    const onUrl = vi.fn(() => pending.promise);
    const handle = createAuthDeepLinkHandler(onUrl);

    const first = handle(url);
    const duplicate = handle(url);
    await handle(null);

    expect(onUrl).toHaveBeenCalledTimes(1);
    expect(onUrl).toHaveBeenCalledWith(url);

    pending.resolve(true);
    await Promise.all([first, duplicate]);
  });

  it('ignores a URL after it was successfully consumed', async () => {
    const onUrl = vi.fn().mockResolvedValue(true);
    const handle = createAuthDeepLinkHandler(onUrl);

    await handle(url);
    await handle(url);

    expect(onUrl).toHaveBeenCalledTimes(1);
  });

  it('retries the same URL after parse-null, session-null, or a thrown consume', async () => {
    const onUrl = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const handle = createAuthDeepLinkHandler(onUrl);

    await handle(url);
    await handle(url);
    await handle(url);
    await handle(url);
    await handle(url);

    expect(onUrl).toHaveBeenCalledTimes(4);
  });

  it('does not treat a different URL as a duplicate of an in-flight one', async () => {
    const pending = deferred<boolean>();
    const onUrl = vi.fn((next: string) => (next === url ? pending.promise : Promise.resolve(true)));
    const handle = createAuthDeepLinkHandler(onUrl);

    const first = handle(url);
    await handle(otherUrl);
    expect(onUrl).toHaveBeenCalledTimes(2);

    pending.resolve(false);
    await first;
    await handle(url);
    expect(onUrl).toHaveBeenCalledTimes(3);
  });
});
