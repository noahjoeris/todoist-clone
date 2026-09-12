/** Save stays disabled while a picker create+select is still in flight. */
export function isTaskSubmitDisabled(input: {
  busy: boolean;
  missing: boolean;
  title: string;
  creatingLabel: boolean;
  projectsReady?: boolean;
  projectSelectionInvalid?: boolean;
}): boolean {
  return (
    input.busy ||
    input.missing ||
    input.title.trim() === '' ||
    input.creatingLabel ||
    input.projectsReady === false ||
    input.projectSelectionInvalid === true
  );
}
