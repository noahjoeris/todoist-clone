import type { CommonPowerSyncDatabase, CrudEntry, CrudTransaction } from '@powersync/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type BackendConnectorOptions,
  createBackendConnector,
  syncUploadUrl,
} from './backend-connector';

const powersyncUrl = 'https://powersync.example';
const apiUrl = 'http://localhost:3000';
const uploadUrl = `${apiUrl}/sync/upload`;
const accessToken = 'access-token';
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function session(overrides: { access_token?: string; expires_at?: number | null } = {}) {
  return {
    access_token: overrides.access_token ?? accessToken,
    expires_at: overrides.expires_at === undefined ? 1_700_000_000 : overrides.expires_at,
  };
}

function createAuth(getSession: ReturnType<typeof vi.fn>): BackendConnectorOptions['auth'] {
  return { getSession: getSession as BackendConnectorOptions['auth']['getSession'] };
}

function crudEntry(overrides: Partial<CrudEntry> = {}): CrudEntry {
  return {
    clientId: 1,
    table: 'tasks',
    id: TASK_ID,
    op: 'PUT',
    opData: { title: 'Buy milk' },
    toJSON: () => ({ op_id: 99, type: 'PUT', tx_id: 7, data: { title: 'Buy milk' } }),
    equals: () => false,
    toComparisonArray: () => [],
    ...overrides,
  } as CrudEntry;
}

function crudTransaction(
  overrides: Partial<Pick<CrudTransaction, 'crud' | 'transactionId'>> & {
    complete?: CrudTransaction['complete'];
  } = {},
): CrudTransaction {
  return {
    crud: overrides.crud ?? [crudEntry()],
    transactionId: overrides.transactionId ?? 7,
    complete: overrides.complete ?? vi.fn(async () => {}),
  } as CrudTransaction;
}

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('syncUploadUrl', () => {
  it('joins /sync/upload without a double slash when the origin has a trailing slash', () => {
    expect(syncUploadUrl('http://localhost:3000/')).toBe('http://localhost:3000/sync/upload');
    expect(syncUploadUrl('http://localhost:3000')).toBe('http://localhost:3000/sync/upload');
  });
});

describe('backend connector', () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const getSession = vi.fn();
  const connector = createBackendConnector({
    auth: createAuth(getSession),
    powersyncUrl,
    apiUrl,
    fetch,
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('fetchCredentials', () => {
    it('returns null when there is no session', async () => {
      getSession.mockResolvedValue({ data: { session: null }, error: null });
      await expect(connector.fetchCredentials()).resolves.toBeNull();
    });

    it('returns the PowerSync endpoint and Supabase access token', async () => {
      getSession.mockResolvedValue({ data: { session: session() }, error: null });
      await expect(connector.fetchCredentials()).resolves.toEqual({
        endpoint: powersyncUrl,
        token: accessToken,
        expiresAt: new Date(1_700_000_000 * 1000),
      });
    });

    it('throws when Supabase reports an error so PowerSync can retry', async () => {
      getSession.mockResolvedValue({
        data: { session: null },
        error: new Error('session store unavailable'),
      });
      await expect(connector.fetchCredentials()).rejects.toThrow('session store unavailable');
    });
  });

  describe('uploadData', () => {
    function stubSession() {
      getSession.mockResolvedValue({ data: { session: session() }, error: null });
    }

    it('posts mapped operations with a bearer token and completes 2xx transactions', async () => {
      stubSession();
      const complete = vi.fn(async () => {});
      const transaction = crudTransaction({ complete });
      const database = {
        getNextCrudTransaction: vi
          .fn<CommonPowerSyncDatabase['getNextCrudTransaction']>()
          .mockResolvedValueOnce(transaction)
          .mockResolvedValueOnce(null),
      };
      fetch.mockResolvedValue(jsonResponse(200, { applied: 1 }));

      await connector.uploadData(database as unknown as CommonPowerSyncDatabase);

      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0] ?? [];
      expect(url).toBe(uploadUrl);
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        transactionId: 7,
        operations: [
          {
            clientId: 1,
            table: 'tasks',
            id: TASK_ID,
            op: 'PUT',
            opData: { title: 'Buy milk' },
          },
        ],
      });
      expect(JSON.parse(String(init?.body)).operations[0]).not.toHaveProperty('op_id');
      expect(complete).toHaveBeenCalledOnce();
    });

    it('loops until getNextCrudTransaction returns null', async () => {
      stubSession();
      const first = crudTransaction({ transactionId: 1, complete: vi.fn(async () => {}) });
      const second = crudTransaction({ transactionId: 2, complete: vi.fn(async () => {}) });
      const database = {
        getNextCrudTransaction: vi
          .fn<CommonPowerSyncDatabase['getNextCrudTransaction']>()
          .mockResolvedValueOnce(first)
          .mockResolvedValueOnce(second)
          .mockResolvedValueOnce(null),
      };
      fetch.mockResolvedValue(jsonResponse(200, { applied: 1 }));

      await connector.uploadData(database as unknown as CommonPowerSyncDatabase);

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(first.complete).toHaveBeenCalledOnce();
      expect(second.complete).toHaveBeenCalledOnce();
    });

    it.each([400, 403])(
      'logs and completes a %s response so the batch is discarded',
      async (status) => {
        stubSession();
        const complete = vi.fn(async () => {});
        const database = {
          getNextCrudTransaction: vi
            .fn<CommonPowerSyncDatabase['getNextCrudTransaction']>()
            .mockResolvedValueOnce(crudTransaction({ complete }))
            .mockResolvedValueOnce(null),
        };
        fetch.mockResolvedValue(jsonResponse(status, { error: 'invalid-request' }));
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        await connector.uploadData(database as unknown as CommonPowerSyncDatabase);

        expect(complete).toHaveBeenCalledOnce();
        expect(logged).toHaveBeenCalledOnce();
        expect(String(logged.mock.calls[0]?.[0])).toContain(String(status));
        logged.mockRestore();
      },
    );

    it.each([401, 500])('throws on %s without completing the transaction', async (status) => {
      stubSession();
      const complete = vi.fn(async () => {});
      const database = {
        getNextCrudTransaction: vi
          .fn<CommonPowerSyncDatabase['getNextCrudTransaction']>()
          .mockResolvedValueOnce(crudTransaction({ complete })),
      };
      fetch.mockResolvedValue(jsonResponse(status, { error: 'unauthorized' }));

      await expect(
        connector.uploadData(database as unknown as CommonPowerSyncDatabase),
      ).rejects.toThrow(`PowerSync upload failed (${status})`);
      expect(complete).not.toHaveBeenCalled();
    });

    it('posts to /sync/upload when the configured origin has a trailing slash', async () => {
      const slashed = createBackendConnector({
        auth: createAuth(getSession),
        powersyncUrl,
        apiUrl: `${apiUrl}/`,
        fetch,
      });
      getSession.mockResolvedValue({ data: { session: session() }, error: null });
      const database = {
        getNextCrudTransaction: vi
          .fn<CommonPowerSyncDatabase['getNextCrudTransaction']>()
          .mockResolvedValueOnce(crudTransaction())
          .mockResolvedValueOnce(null),
      };
      fetch.mockResolvedValue(jsonResponse(200, { applied: 1 }));

      await slashed.uploadData(database as unknown as CommonPowerSyncDatabase);

      expect(fetch.mock.calls[0]?.[0]).toBe(uploadUrl);
    });

    it('throws on network failure without completing the transaction', async () => {
      stubSession();
      const complete = vi.fn(async () => {});
      const database = {
        getNextCrudTransaction: vi
          .fn<CommonPowerSyncDatabase['getNextCrudTransaction']>()
          .mockResolvedValueOnce(crudTransaction({ complete })),
      };
      fetch.mockRejectedValue(new Error('Failed to fetch'));

      await expect(
        connector.uploadData(database as unknown as CommonPowerSyncDatabase),
      ).rejects.toThrow('Failed to fetch');
      expect(complete).not.toHaveBeenCalled();
    });
  });
});
