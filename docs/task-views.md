# Inbox, Today, and Upcoming

The app has three task destinations. Filtering and grouping run locally through the
repository layer (not a per-view server fetch). Guest `local_tasks` and account-owned
`tasks` use the same view rules.

## Membership

- **Inbox** — every task that does not belong to a project, including scheduled tasks.
  Until projects exist, that is every task. Inbox is the default on launch. It is not
  “unscheduled only.”
- **Today** — active tasks with `scheduled_date` before today (Overdue) plus tasks dated
  today. Unscheduled and future tasks are omitted. A wall-clock time earlier today does
  not create a separate overdue state; overdue is date-only.
- **Upcoming** — active tasks strictly after today, grouped by local calendar date.
  The first window is the next 30 days starting tomorrow. **Load more** extends that
  exclusive end by another 30 calendar days. Headings appear only for dates that have
  tasks. An empty range shows an empty state.

Completed tasks sit in a collapsed section at the bottom of the current destination.
Membership uses **scheduled date**, not completion date, and the same date window as
the active list. Completed rows are excluded from the Inbox and Today badges.

## Ordering

- Inbox (active): priority ascending, then `createdAt` descending, then id.
- Today / Upcoming (active): scheduled date ascending, timed tasks before date-only,
  scheduled time ascending, priority ascending, then `createdAt` / id.
- Completed: `completedAt` descending, then id.

## Creating and rescheduling

New tasks default to no date in Inbox, today in Today, and the selected day when adding
inside an Upcoming date group. The sidebar **Add task** action is always unscheduled
and does not copy the first visible Upcoming group.

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
