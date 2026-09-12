import {
  createDatabaseConnection,
  type DatabaseConnection,
  eq,
  schema,
  sql,
} from '@todoist-clone/database';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import {
  type CryptoKey,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';

export const OWNER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ID = '22222222-2222-4222-8222-222222222222';
export const CASCADE_ID = '33333333-3333-4333-8333-333333333333';

const CREATED_AT = '2026-09-11T12:00:00.000Z';

export function putOp(
  id: string,
  opData: Record<string, unknown> = {},
  clientId = 1,
): {
  clientId: number;
  op: 'PUT';
  table: 'tasks';
  id: string;
  opData: Record<string, unknown>;
} {
  return {
    clientId,
    op: 'PUT',
    table: 'tasks',
    id,
    opData: {
      title: 'Task',
      description: '',
      priority: 4,
      scheduled_date: null,
      scheduled_time: null,
      created_at: CREATED_AT,
      ...opData,
    },
  };
}

export function putLabelOp(
  id: string,
  opData: Record<string, unknown> = {},
  clientId = 1,
): {
  clientId: number;
  op: 'PUT';
  table: 'labels';
  id: string;
  opData: Record<string, unknown>;
} {
  return {
    clientId,
    op: 'PUT',
    table: 'labels',
    id,
    opData: {
      name: 'Work',
      color: 'charcoal',
      is_favorite: false,
      created_at: CREATED_AT,
      ...opData,
    },
  };
}

export function putTaskLabelOp(
  id: string,
  taskId: string,
  labelId: string,
  opData: Record<string, unknown> = {},
  clientId = 1,
): {
  clientId: number;
  op: 'PUT';
  table: 'task_labels';
  id: string;
  opData: Record<string, unknown>;
} {
  return {
    clientId,
    op: 'PUT',
    table: 'task_labels',
    id,
    opData: {
      task_id: taskId,
      label_id: labelId,
      created_at: CREATED_AT,
      ...opData,
    },
  };
}

export let app: FastifyInstance;
export let database: DatabaseConnection;

let privateKey: CryptoKey;
let getKey: JWTVerifyGetKey;

export async function sign(subject: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: 'key-1' })
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .setSubject(subject)
    .sign(privateKey);
}

export async function upload(
  subject: string,
  operations: unknown[],
  transactionId?: number,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/sync/upload',
    headers: { authorization: `Bearer ${await sign(subject)}` },
    payload: transactionId === undefined ? { operations } : { transactionId, operations },
  });
}

/** Postgres timestamptz string → ISO-8601 Instant (e.g. ...T15:00:00.000Z). */
function toIsoInstant(value: string): string {
  return new Date(value).toISOString();
}

export async function loadTask(id: string) {
  const [row] = await database.db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  if (!row) return null;
  // Drizzle mode:'string' returns driver text like '2026-09-11 15:00:00+00'.
  // Normalize to ISO so assertions compare Instant equality, not wire form.
  return {
    ...row,
    completedAt: row.completedAt == null ? null : toIsoInstant(row.completedAt),
    createdAt: toIsoInstant(row.createdAt),
    updatedAt: toIsoInstant(row.updatedAt),
  };
}

export async function loadLabel(id: string) {
  const [row] = await database.db.select().from(schema.labels).where(eq(schema.labels.id, id));
  if (!row) return null;
  return {
    ...row,
    createdAt: toIsoInstant(row.createdAt),
    updatedAt: toIsoInstant(row.updatedAt),
  };
}

export async function loadTaskLabel(id: string) {
  const [row] = await database.db
    .select()
    .from(schema.taskLabels)
    .where(eq(schema.taskLabels.id, id));
  if (!row) return null;
  return {
    ...row,
    createdAt: toIsoInstant(row.createdAt),
  };
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for API integration tests');
  }

  const key = await generateKeyPair('ES256', { extractable: true });
  privateKey = key.privateKey;
  const jwk = await exportJWK(key.publicKey);
  jwk.kid = 'key-1';
  getKey = createLocalJWKSet({ keys: [jwk] });

  database = createDatabaseConnection({ url: databaseUrl, maxConnections: 4 });

  await database.db.execute(sql`SET session_replication_role = replica`);
  await database.db.execute(
    sql`INSERT INTO auth.users (id) VALUES (${OWNER_ID}::uuid), (${OTHER_ID}::uuid), (${CASCADE_ID}::uuid) ON CONFLICT (id) DO NOTHING`,
  );
  await database.db.execute(sql`SET session_replication_role = DEFAULT`);

  app = await buildApp({
    env: loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      SUPABASE_URL: process.env.SUPABASE_URL ?? 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? 'sb_secret_test',
    }),
    version: '0.0.0',
    logger: false,
    database,
    getKey,
  });
  await app.ready();
});

beforeEach(async () => {
  await database.db.execute(sql`TRUNCATE public.task_labels, public.labels, public.tasks`);
});

afterAll(async () => {
  if (app) await app.close();
});
