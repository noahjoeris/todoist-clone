import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseConnection {
  db: Database;
  close: () => Promise<void>;
}

export interface DatabaseOptions {
  /** Postgres connection string for the application runtime role. */
  url: string;
  /** Upper bound on pooled connections. Keep low when going through Supavisor. */
  maxConnections?: number;
}

/**
 * Creates a Drizzle client over a postgres-js pool.
 *
 * The connection uses a fixed database role, so Supabase RLS does not apply the
 * end user's identity automatically. Authorization for writes is the API's job.
 */
export function createDatabaseConnection(options: DatabaseOptions): DatabaseConnection {
  const client = postgres(options.url, {
    max: options.maxConnections ?? 10,
    // Supavisor (transaction pooling) does not support prepared statements.
    prepare: false,
  });

  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

export { schema };
