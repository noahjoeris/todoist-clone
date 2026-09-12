export class ForbiddenError extends Error {
  readonly code = 'forbidden' as const;

  constructor() {
    super('forbidden');
    this.name = 'ForbiddenError';
  }
}

export class InvalidRequestError extends Error {
  readonly code = 'invalid-request' as const;
  readonly issues: { path: string; message: string }[];

  constructor(issues: { path: string; message: string }[]) {
    super('invalid-request');
    this.name = 'InvalidRequestError';
    this.issues = issues;
  }
}

export const LABELS_NAME_UNIQUE = 'labels_user_id_lower_name_idx';
export const PROJECTS_NAME_UNIQUE = 'projects_user_id_lower_name_idx';
export const TASK_LABELS_PAIR_UNIQUE = 'task_labels_task_id_label_id_uidx';

export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      const code = 'code' in current ? current.code : undefined;
      const constraint =
        'constraint_name' in current
          ? current.constraint_name
          : 'constraint' in current
            ? current.constraint
            : undefined;
      if (code === '23505' && constraint === constraintName) {
        return true;
      }
      if ('cause' in current) {
        current = current.cause;
        continue;
      }
    }
    break;
  }
  return false;
}

export function duplicateLabelNameError(): InvalidRequestError {
  return new InvalidRequestError([
    { path: 'name', message: 'A label with this name already exists' },
  ]);
}

export function duplicateProjectNameError(): InvalidRequestError {
  return new InvalidRequestError([
    { path: 'name', message: 'A project with this name already exists' },
  ]);
}
