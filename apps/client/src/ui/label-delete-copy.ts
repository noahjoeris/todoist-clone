export function deleteMessage(name: string, affectedCount: number): string {
  if (affectedCount === 0) {
    return `Delete “${name}”? It is not on any tasks.`;
  }
  const tasks = affectedCount === 1 ? '1 task' : `${affectedCount} tasks`;
  return `Delete “${name}”? It will be removed from ${tasks}, including completed ones. Tasks themselves will not be deleted.`;
}
