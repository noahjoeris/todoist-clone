/** Save stays disabled while a picker create+select is still in flight. */
export function isTaskSubmitDisabled(input: {
  busy: boolean;
  missing: boolean;
  title: string;
  creatingLabel: boolean;
}): boolean {
  return input.busy || input.missing || input.title.trim() === '' || input.creatingLabel;
}
