export type ProjectsTab = 'active' | 'archived';

/** Sidebar Add project opens the create form on Active, even if Projects is already mounted. */
export function projectsTabForCreate(adding: boolean, tab: ProjectsTab): ProjectsTab {
  return adding ? 'active' : tab;
}
