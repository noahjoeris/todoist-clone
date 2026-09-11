import type {
  CommonPowerSyncDatabase,
  CrudEntry,
  CrudTransaction,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/common';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface BackendConnectorOptions {
  auth: Pick<SupabaseClient['auth'], 'getSession'>;
  powersyncUrl: string;
  apiUrl: string;
  /** Account whose upload queue this connector is allowed to post. */
  expectedUserId: string;
  fetch?: typeof globalThis.fetch;
}

type ConnectorSession = {
  access_token: string;
  expires_at?: number | null;
  user?: { id?: string } | null;
};

/**
 * Uploads local `tasks` writes to the Fastify API and vends the Supabase access token
 * as the PowerSync credential. Tokens stay in `src/data`; the UI never sees them.
 *
 * Each connector is bound to one account. A session for a different user is rejected
 * so an in-flight `uploadData` loop cannot POST the previous queue under a new JWT
 * (the API strips `user_id` and assigns ownership from the token).
 */
export function createBackendConnector(
  options: BackendConnectorOptions,
): PowerSyncBackendConnector {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const uploadUrl = syncUploadUrl(options.apiUrl);

  return {
    async fetchCredentials(): Promise<PowerSyncCredentials | null> {
      const { data, error } = await options.auth.getSession();
      if (error) throw error;
      const session = data.session;
      if (!session) return null;
      assertExpectedAccount(session, options.expectedUserId);

      const credentials: PowerSyncCredentials = {
        endpoint: options.powersyncUrl,
        token: session.access_token,
      };
      if (session.expires_at != null) {
        credentials.expiresAt = new Date(session.expires_at * 1000);
      }
      return credentials;
    },

    async uploadData(database: CommonPowerSyncDatabase): Promise<void> {
      for (;;) {
        const transaction = await database.getNextCrudTransaction();
        if (transaction == null) return;
        await uploadTransaction(
          transaction,
          options.auth,
          fetchImpl,
          uploadUrl,
          options.expectedUserId,
        );
      }
    },
  };
}

async function uploadTransaction(
  transaction: CrudTransaction,
  auth: BackendConnectorOptions['auth'],
  fetchImpl: typeof globalThis.fetch,
  uploadUrl: string,
  expectedUserId: string,
): Promise<void> {
  const { data, error } = await auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session) throw new Error('PowerSync upload requires a session');
  assertExpectedAccount(session, expectedUserId);
  const token = session.access_token;

  let response: Response;
  try {
    response = await fetchImpl(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transactionId: transaction.transactionId,
        operations: transaction.crud.map(toUploadOperation),
      }),
    });
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error('PowerSync upload network error', { cause });
  }

  if (response.ok) {
    await transaction.complete();
    return;
  }

  if (response.status === 400 || response.status === 403) {
    const body = await response.text().catch(() => '');
    console.error(`PowerSync upload discarded (${response.status}): ${body}`);
    await transaction.complete();
    return;
  }

  // 401: token expired between getSession and the request; PowerSync retries after refresh.
  // 5xx / anything else: retry.
  throw new Error(`PowerSync upload failed (${response.status})`);
}

/** Resolves `/sync/upload` against the API origin even when the origin has a trailing slash. */
export function syncUploadUrl(apiUrl: string): string {
  const base = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;
  return new URL('sync/upload', base).href;
}

function toUploadOperation(entry: CrudEntry) {
  return {
    clientId: entry.clientId,
    table: entry.table,
    id: entry.id,
    op: entry.op,
    opData: entry.opData,
  };
}

function assertExpectedAccount(session: ConnectorSession, expectedUserId: string): void {
  if (session.user?.id !== expectedUserId) {
    throw new Error('PowerSync session is for a different account');
  }
}
