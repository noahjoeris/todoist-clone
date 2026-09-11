import { describe, expect, it } from 'vitest';
import { signOutAvailability } from './account-sign-out';

describe('signOutAvailability', () => {
  it('fails closed while the queue count is unknown', () => {
    expect(signOutAvailability({ status: 'unknown' })).toEqual({ action: 'checking' });
  });

  it('blocks ordinary sign-out when uploads are queued', () => {
    expect(signOutAvailability({ status: 'ready', count: 1 })).toEqual({
      action: 'wait',
      count: 1,
    });
    expect(signOutAvailability({ status: 'ready', count: 4 })).toEqual({
      action: 'wait',
      count: 4,
    });
  });

  it('allows ordinary sign-out only after a successful empty-queue check', () => {
    expect(signOutAvailability({ status: 'ready', count: 0 })).toEqual({ action: 'sign-out' });
  });
});
