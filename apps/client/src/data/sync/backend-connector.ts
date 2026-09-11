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
  fetch?: typeof globalThis.fetch;
}

/**
 * Uploads local `tasks` writes to the Fastify API and vends the Supabase access token
 * as the PowerSync credential. Tokens stay in `src/data`; the UI never sees them.
 */
export function createBackendConnector(
  options: BackendConnectorOptions,
): PowerSyncBackendConnector {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const uploadUrl = `${options.apiUrl}/sync/upload`;

  return {
    async fetchCredentials(): Promise<PowerSyncCredentials | null> {
      const { data, error } = await options.auth.getSession();
      if (error) throw error;
      const session = data.session;
      if (!session) return null;

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
        await uploadTransaction(transaction, options.auth, fetchImpl, uploadUrl);
      }
    },
  };
}

async function uploadTransaction(
  transaction: CrudTransaction,
  auth: BackendConnectorOptions['auth'],
  fetchImpl: typeof globalThis.fetch,
  uploadUrl: string,
): Promise<void> {
  const { data, error } = await auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('PowerSync upload requires a session');

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

function toUploadOperation(entry: CrudEntry) {
  return {
    clientId: entry.clientId,
    table: entry.table,
    id: entry.id,
    op: entry.op,
    opData: entry.opData,
  };
}
