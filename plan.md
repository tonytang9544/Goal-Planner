# Home Month Planner: Implementation Plan

## Product direction

Build a personal planning app for a household, not a collaborative project-management board. Each person has an account and their own plans, organized hierarchically as **month → week → day**. A household competition chart can compare how consistently users keep up with their plans.

## Recommended architecture

```text
Phones / laptops / TV browser
            │  HTTP on home Wi-Fi
            ▼
Raspberry Pi 2
  ├── Rust server: authentication, planner API, and built frontend
  └── SQLite database: users, plans, and progress history
```

- **Frontend:** TypeScript with React and Vite. Build it into static files and serve them from the backend, so there is one service and one address to maintain.
- **Backend:** Rust with Axum. Compile to an ARM Linux binary to avoid a separate runtime and keep memory use modest.
- **Database:** SQLite in a persistent data directory on the Pi. Use migrations and regular backups so updates do not discard household plans.
- **Updates:** Start with short-interval polling for updates made by other household members. This is simpler to operate than WebSockets and should be sufficient for a home app.

## Implementation plan

### 1. Set up the app and data model

- Create the React/TypeScript frontend and Rust API.
- Model users, sessions, months, weeks, days, planned items, completion history, and timestamps.
- Make each plan item belong to one user and one day; derive week and month views from its date rather than duplicating the item in multiple places.
- Keep plan data private to its owner by default. The competition chart should expose only the progress information needed for comparison, not personal plan titles or descriptions.
- Support one household initially, with multiple individual accounts.

### 2. Build the planner experience

- Provide a month view with week rows and a clear summary of each day's planned items.
- Let users open a week to see its seven days, then open a day to add, edit, reorder, complete, or remove planned items.
- Support useful planner details such as title, optional notes, due time, and completion status.
- Make it straightforward to move an item to another day and to navigate between months, weeks, and days.
- Design responsive views for phones and laptops, plus a read-only TV presentation page for the whole household.
- On the TV page, show today's target list for every household user: each person's name, target titles, due times when set, completion state, and completed/total count. Keep private notes off the shared display.
- Show a per-user daily progress bar and separate streak counters for (1) consecutive target-days when every target was completed and (2) consecutive target-days when at least one target was completed.
- Define a target-day as a local calendar day with at least one target. A day with no targets does not increase a streak and breaks a consecutive target-day streak; display this rule so an empty day is not mistaken for a completed day.
- Treat today as in progress: count it toward a streak as soon as its relevant completion condition is met; until then, show the prior streak without breaking it. Once a day has ended, an empty or incomplete target-day breaks the applicable streak.
- Use one configured household timezone for day boundaries, due dates, and streak calculations. Mark today's date clearly, and refresh the shared display periodically so it stays current.
- Include keyboard-accessible controls and clear empty states for days with no plans.

### 3. Add accounts, API, and persistence

- Provide registration or household-admin account creation, sign-in, sign-out, and session expiry.
- Hash passwords with a modern password-hashing algorithm; never store plaintext passwords.
- Enforce ownership on the backend for every private plan read and write.
- Provide REST endpoints for accounts, sessions, plans, completion updates, and household progress summaries.
- Validate inputs and persist changes in SQLite using transactions where multiple records must change together.
- Add schema migrations and short-interval polling so changes and progress from other devices become visible.
- Preserve enough timestamped plan and completion history to calculate daily totals and consecutive streaks consistently across edits and devices.

### 4. Define and implement a competition page for the TV

- Use a transparent measure of follow-through, such as the percentage of planned items completed by their due day within a selected week or month.
- Define how rescheduled, deleted, overdue, and newly added items affect the score before implementing rankings; make the rules visible to all household users.
- Calculate an all-targets-cleared streak only for target-days when the user completed every target, and an at-least-one-completed streak only when at least one target was completed. Count consecutive target-days; a day with no targets breaks either streak and never counts as a perfect day.
- Calculate each day in the household timezone and retain the plan/completion history needed to avoid later edits silently rewriting past streak results. Document how same-day additions, removals, and rescheduling affect that day's target set.
- Rank the competition leaderboard by the existing all-targets-cleared streak, then the at-least-one streak; show weekly or monthly completion percentage and its completed/planned totals as context, not as a task-volume bonus.
- For completion percentages, count the target set and completion state as recorded at the end of each household-local day. Subsequent edits do not change a closed day's score; same-day additions, removals, and rescheduling made before the day closes affect that day's target set. Exclude future days and include today's live progress.
- Make the TV route a read-only presentation with two separate views: today's household targets and the competition chart. Provide clear TV-friendly controls to toggle back and forth without leaving the TV route; keep today's targets as the default view.
- Show household rankings by week and month on the competition view, with accessible charts and a non-chart summary.
- Keep personal notes private. The TV page is an intentional shared surface for all users' daily target titles and completion state; limit it to that day's targets and the progress/streak information, without exposing notes or unrelated future plans.

### 5. Add yearly goals and a goal wizard to the planner

- Add private yearly goals for each user. Provide a view-only Yearly Goals page that lists the signed-in user's goals and their ordered objectives.
- Add an objectives panel to the left of the month and week planner views. In month view, show objectives scheduled for weeks within the selected month; in week view, show the objectives assigned to the selected week.
- Add a Goal Wizard entry point in the planner. Its first screen asks whether to modify an existing goal, add a goal, or remove a goal.
- For adding a goal, collect its name and an ordered list of objectives. For modifying a goal, let the user select one of their goals and edit its name and ordered objectives. For removal, let the user select a goal and confirm its deletion.
- For adding or modifying a goal, show a year map made of selectable square cells, one per calendar week, with visible month boundaries and labels. Use the planner's Monday-start week convention and distinguish weeks that overlap two months or calendar years.
- Let the user assign each ordered objective to one or more week cells. Clicking a month label or month region selects or clears all week cells that overlap that month; individual week cells remain independently selectable so assignments can be refined afterward.
- Translate the saved week assignments into the month/week objectives panels. When a week overlaps two months, show its assigned objective in both affected months and in that week's panel.
- Keep goals and objective assignments private to their owner. Persist them in SQLite with migrations and owner-scoped APIs; edits from the wizard update the view-only yearly list and planner panels.
- Make the wizard and week map usable with keyboard as well as pointer input, and clearly distinguish selected weeks, month boundaries, and weeks shared across months.

### 6. Test the important behaviors

- Unit-test date boundaries, month/week/day grouping, completion calculations, and score rules.
- Test yearly goal ownership, objective ordering, week-to-month mapping (including cross-month and cross-year weeks), and wizard add/edit/remove flows.
- Test account/session behavior and verify that one user cannot access another user's private plan data.
- Test API operations and migrations against a temporary SQLite database.
- Check responsive layouts at phone, desktop, and TV-sized resolutions, including keyboard navigation.
- Verify the release binary and frontend build on the Pi's actual OS and architecture; the Pi 2 model and OS image can affect the correct target.

### 7. Deploy and operate it on the Pi

- Build a release bundle containing the Rust binary and frontend assets.
- Run it as a `systemd` service so it starts on boot and restarts if it exits.
- Keep the database and backups in a dedicated persistent data directory, separate from app updates.
- Give the Pi a DHCP reservation and, if available, enable local hostname discovery. Otherwise, household members can use its reserved IP address.
- Keep access restricted to the home network; do not expose the app directly to the internet.
- Back up the SQLite database regularly using a SQLite-aware backup method, and test restoring a backup.

## Suggested MVP scope

Start with account sign-in, a user's month/week/day views, personal daily items with completion, and a TV household page showing today's targets and the two streak measures for every user. Keep notes private, make the shared display and scoring rules explicit, and verify that the app runs comfortably on the Pi before adding reminders, recurring plans, or internet access.
