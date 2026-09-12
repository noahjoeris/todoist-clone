import type { CrudEntry } from '@todoist-clone/contracts';
import { applyLabelOperation } from './apply-label.js';
import { applyTaskOperation } from './apply-task.js';
import { applyTaskLabelOperation } from './apply-task-label.js';
import type { UploadExecutor } from './types.js';

export { ForbiddenError, InvalidRequestError } from './errors.js';

export async function applyUpload(
  tx: UploadExecutor,
  userId: string,
  operations: CrudEntry[],
): Promise<void> {
  for (const operation of operations) {
    switch (operation.table) {
      case 'tasks':
        await applyTaskOperation(tx, userId, operation);
        break;
      case 'labels':
        await applyLabelOperation(tx, userId, operation);
        break;
      case 'task_labels':
        await applyTaskLabelOperation(tx, userId, operation);
        break;
    }
  }
}
