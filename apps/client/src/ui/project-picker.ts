import { foldProjectName, type ProjectListItem, type ProjectSummary } from '../data/repositories';

export type ProjectPickerOption = {
  id: string | null;
  name: string;
  color: ProjectSummary['color'] | null;
  archived: boolean;
};

export function filterProjectsByQuery<T extends { name: string }>(
  projects: T[],
  query: string,
): T[] {
  const needle = foldProjectName(query);
  if (needle === '') return projects;
  return projects.filter((project) => foldProjectName(project.name).includes(needle));
}

export function inboxMatchesQuery(query: string): boolean {
  const needle = foldProjectName(query);
  return needle === '' || 'inbox'.includes(needle);
}

/**
 * Active projects in catalog order, plus the currently selected archived project
 * so an unrelated edit never clears it. Inbox is handled separately.
 */
export function projectPickerChoices(
  projects: readonly ProjectListItem[],
  selectedId: string | null,
  query: string,
): ProjectPickerOption[] {
  const active = filterProjectsByQuery(
    projects.filter((project) => !project.isArchived),
    query,
  ).map((project) => ({
    id: project.id,
    name: project.name,
    color: project.color,
    archived: false,
  }));

  if (selectedId == null) return active;
  if (active.some((project) => project.id === selectedId)) return active;

  const selected = projects.find((project) => project.id === selectedId);
  if (selected == null) return active;
  if (query !== '' && filterProjectsByQuery([selected], query).length === 0) return active;

  return [
    ...active,
    {
      id: selected.id,
      name: selected.name,
      color: selected.color,
      archived: selected.isArchived,
    },
  ];
}

export function isProjectSelectionValid(
  selectedId: string | null,
  projects: readonly Pick<ProjectListItem, 'id'>[],
  ready: boolean,
): boolean {
  if (!ready) return false;
  if (selectedId == null) return true;
  return projects.some((project) => project.id === selectedId);
}
