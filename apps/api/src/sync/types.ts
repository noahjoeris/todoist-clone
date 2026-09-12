import type { Database } from '@todoist-clone/database';

export type UploadExecutor = Pick<Database, 'insert' | 'update' | 'delete' | 'select' | 'execute'>;
