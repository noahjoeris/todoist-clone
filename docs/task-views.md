# Inbox, Today, and Upcoming

The app has three task destinations. Filtering and grouping run locally through the
repository layer (not a per-view server fetch). Guest `local_tasks` and account-owned
`tasks` use the same view rules.

## Membership

- **Inbox** — every account task with `project_id IS NULL`, including scheduled tasks.
  Inbox is the default on launch. It is not “unscheduled only,” and it is not archived
  membership. Guest Inbox is every guest task (there is no `project_id` column).
- **Today** — active tasks with `scheduled_date` before today (Overdue) plus tasks dated
  today, across every project including archived ones. Unscheduled and future tasks are
  omitted. A wall-clock time earlier today does not create a separate overdue state;
  overdue is date-only.
- **Upcoming** — active tasks strictly after today, grouped by local calendar date,
  also across every project including archived ones. The first window is the next 30
  days starting tomorrow. **Load more** extends that exclusive end by another 30
  calendar days. Headings appear only for dates that have tasks. An empty range shows
  an empty state.
- **Project** — every task whose `project_id` matches that owned project, dated or
  undated. Active ordering matches Inbox. Completed tasks sit in the same collapsed
  section as other views. A dated task can appear in both its project and
  Today/Upcoming.

Completed tasks sit in a collapsed section at the bottom of the current destination.
Membership uses **scheduled date**, not completion date, and the same date window as
the active list. Completed rows are excluded from the Inbox and Today badges.

## Ordering

- Inbox / label / project (active): priority ascending, then `createdAt` descending, then id.
- Today / Upcoming (active): scheduled date ascending, timed tasks before date-only,
  scheduled time ascending, priority ascending, then `createdAt` / id.
- Completed: `completedAt` descending, then id.
- Projects themselves sort by `sort_order` then id. That order is not applied to tasks.

## Creating and rescheduling

New tasks default to no date in Inbox, today in Today, and the selected day when adding
inside an Upcoming date group. Creating inside an active project defaults to that
project and no date. Creating inside Today/Upcoming defaults to Inbox plus the view’s
date. Creating inside a label view defaults to Inbox plus that label. The sidebar
**Add task** action is always unscheduled Inbox, with no inherited project or label.
Changing the project picker does not change date or labels. An archived project view
has no new-task composer.

Quick reschedule on a row: **Today**, **Tomorrow**, **Choose date**, **No date**.
Choosing another date keeps the existing time; clearing the date also clears the time.

## Responsive shell

From 900 logical pixels wide, a persistent ~260px sidebar sits beside the task pane.
Narrower widths use a menu button and a dismissible overlay drawer with the same
navigation (account/guest, Add task, Inbox, Today, Upcoming). Inbox and Today show
live active counts; Upcoming does not, because its range is expandable.

The selected destination is kept while opening account settings and returning in the
same session, and resets to Inbox when the guest/account identity changes. Unsaved
composer or editor drafts use the existing discard confirmation.

## Labels

Account-only. Guests do not see label chips, the picker, Labels navigation, or
favorites.

Opening a label shows its active tasks with Inbox ordering and a collapsed
Completed section (membership is the association, including completed tasks
dated for that view’s rules). New tasks added from that view default to the
selected label. Sidebar **Add task** stays unscheduled and does not copy the
label. Deleting the label currently in view returns to Inbox.

The Labels management screen lists every label alphabetically with active-task
counts. Favorite labels appear in the sidebar, also alphabetically. Rename,
recolor, favorite, and count changes update live through the repository
subscriptions.

## Projects

Account-only. Guests do not see My Projects, project favorites, the picker, or
project markers on rows.

**My Projects** lists active projects in manual order with live names, colors, and
active-task counts. Favorite projects appear first under **Favorites**, still in
that manual order, then favorite labels alphabetically. Archived projects leave
both lists but keep the favorite flag and reappear on unarchive. The Projects
screen has Active and Archived tabs; archive does not complete or move tasks.

Delete confirmation counts every affected task, including completed ones: those
tasks move to Inbox and are not deleted. Deleting the project currently in view
returns to Inbox once the catalog is loaded. Undo of a deleted task restores
project membership only if that owned project still exists.

A compact name/color marker appears on account task rows in Today, Upcoming, and
label views, with an Archived annotation when applicable. Inbox is null
membership, so those rows have no project marker.
