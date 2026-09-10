import { describe, expect, it } from 'vitest';
import { meResponseSchema } from './me.js';

describe('meResponseSchema', () => {
  it('accepts a user id', () => {
    expect(meResponseSchema.parse({ id: '11111111-1111-4111-8111-111111111111' })).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('rejects a missing id', () => {
    expect(meResponseSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    expect(meResponseSchema.safeParse({ id: 'user-1' }).success).toBe(false);
  });
});
