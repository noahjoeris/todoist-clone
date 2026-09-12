/**
 * Repository layer: the only place the UI is allowed to touch the local database.
 *
 * Each repository wraps a PowerSync database and exposes intention-revealing methods
 * (`listTasksForToday()`, `completeTask(id)`), hiding SQL and PowerSync APIs from components.
 * Business rules (validation, derived state) live here or in pure helpers next to the
 * repository so they can be unit-tested without a database.
 *
 */

export {
  AuthFailure,
  type AuthFailureCode,
  type AuthState,
  type AuthUser,
  type Credentials,
  credentialsSchema,
  emailSchema,
  MIN_PASSWORD_LENGTH,
  passwordSchema,
} from './auth';
export {
  type AuthRepository,
  createAuthRepository,
  type SignUpOutcome,
} from './auth-repository';
export {
  createGuestTaskAdoptionRepository,
  type GuestTaskAdoptionRepository,
  type GuestTaskAdoptionState,
} from './guest-task-adoption';
export {
  foldLabelName,
  LABEL_COLORS,
  type LabelColor,
  LabelDuplicateNameError,
  type LabelFields,
  type LabelInput,
  type LabelListItem,
  LabelNotFoundError,
  type LabelPatch,
  type LabelSummary,
  labelInputSchema,
  labelNameSchema,
  labelNamesEqual,
} from './label';
export { labelIdsForSubmit, sameIdSet } from './label-associations';
export {
  createLabelRepositories,
  createLabelRepository,
  type LabelRepositories,
  type LabelRepository,
} from './label-repository';
export {
  activeProjects,
  archivedProjects,
  favoriteProjects,
  foldProjectName,
  MAX_UPLOAD_OPERATIONS,
  ProjectDuplicateNameError,
  type ProjectFields,
  type ProjectInput,
  type ProjectListItem,
  ProjectNotFoundError,
  ProjectOperationTooLargeError,
  type ProjectPatch,
  ProjectStaleListError,
  type ProjectSummary,
  projectInputSchema,
  projectNameSchema,
  projectNamesEqual,
} from './project';
export {
  createProjectRepositories,
  createProjectRepository,
  type ProjectRepositories,
  type ProjectRepository,
} from './project-repository';
export {
  createRecentSearchRepositories,
  createRecentSearchRepository,
  type RecentSearchRepositories,
  type RecentSearchRepository,
} from './recent-search-repository';
export type { ClientSyncStatus, SyncStatusSource } from './sync';
export {
  projectIdForSubmit,
  type Task,
  type TaskInput,
  type TaskLabelEdit,
  TaskNotFoundError,
  type TaskPriority,
  type TaskProjectEdit,
  TaskRestoreConflictError,
  taskInputSchema,
} from './task';
export {
  createTaskRepositories,
  createTaskRepository,
  type TaskRepositories,
  type TaskRepository,
  type TaskSearchQuery,
  type TaskSearchSnapshot,
} from './task-repository';
export {
  MAX_RECENT_SEARCHES,
  MAX_SEARCH_QUERY_LENGTH,
  parseSearchQuery,
  SEARCH_PAGE_SIZE,
  SEARCH_TOP_COUNT,
} from './task-search';
export {
  type TaskActiveCounts,
  type TaskCompletionSelection,
  type TaskDestination,
  type TaskViewQuery,
  UPCOMING_PAGE_DAYS,
} from './task-view';
