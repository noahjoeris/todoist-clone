import {
  createDatabaseConnection,
  type Database,
  type DatabaseConnection,
} from '@todoist-clone/database';
import fp from 'fastify-plugin';

export interface DatabasePluginOptions {
  url: string;
  connection?: DatabaseConnection;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export const databasePlugin = fp<DatabasePluginOptions>(
  async (app, options) => {
    const connection = options.connection ?? createDatabaseConnection({ url: options.url });
    app.decorate('db', connection.db);
    app.addHook('onClose', () => connection.close());
  },
  { name: 'database' },
);
