import { readFileSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return packageJson.version;
}

async function main(): Promise<void> {
  const env = loadEnv();

  const app = await buildApp({
    env,
    version: readPackageVersion(),
    logger:
      env.NODE_ENV === 'development'
        ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty' } }
        : { level: env.LOG_LEVEL },
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
