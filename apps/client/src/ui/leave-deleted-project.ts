/** Remote delete of the open project: discard if dirty, otherwise leave. */
export async function confirmLeaveDeletedProject(input: {
  isDirty: boolean;
  confirmDiscard: () => Promise<boolean>;
}): Promise<'stay' | 'leave'> {
  if (!input.isDirty) return 'leave';
  return (await input.confirmDiscard()) ? 'leave' : 'stay';
}
