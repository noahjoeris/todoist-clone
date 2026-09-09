import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts a valid payload', () => {
    expect(healthResponseSchema.parse({ status: 'ok', version: '0.0.0' })).toEqual({
      status: 'ok',
      version: '0.0.0',
    });
  });

  it('rejects an unknown status', () => {
    expect(healthResponseSchema.safeParse({ status: 'down', version: '0.0.0' }).success).toBe(
      false,
    );
  });
});
