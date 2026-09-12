export function deleteProjectMessage(name: string, affectedCount: number): string {
  if (affectedCount === 0) {
    return `Delete “${name}”? It has no tasks.`;
  }
  const tasks = affectedCount === 1 ? '1 task' : `${affectedCount} tasks`;
  return `Delete “${name}”? ${tasks} will move to Inbox, including completed tasks. None of the tasks will be deleted.`;
}
