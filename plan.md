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

### 4. Define and implement the competition chart

- Use a transparent measure of follow-through, such as the percentage of planned items completed by their due day within a selected week or month.
- Define how rescheduled, deleted, overdue, and newly added items affect the score before implementing rankings; make the rules visible to all household users.
- Calculate an all-targets-cleared streak only for target-days when the user completed every target, and an at-least-one-completed streak only when at least one target was completed. Count consecutive target-days; a day with no targets breaks either streak and never counts as a perfect day.
- Calculate each day in the household timezone and retain the plan/completion history needed to avoid later edits silently rewriting past streak results. Document how same-day additions, removals, and rescheduling affect that day's target set.
- Avoid rewarding raw task volume so users are not encouraged to create many trivial items. Show the underlying completed and planned totals alongside percentages.
- Show household rankings by week and month, with accessible charts and a non-chart summary.
- Keep personal notes private. The TV page is an intentional shared surface for all users' daily target titles and completion state; limit it to that day's targets and the progress/streak information, without exposing notes or unrelated future plans.

### 5. Test the important behaviors

- Unit-test date boundaries, month/week/day grouping, completion calculations, and score rules.
- Test account/session behavior and verify that one user cannot access another user's private plan data.
- Test API operations and migrations against a temporary SQLite database.
- Check responsive layouts at phone, desktop, and TV-sized resolutions, including keyboard navigation.
- Verify the release binary and frontend build on the Pi's actual OS and architecture; the Pi 2 model and OS image can affect the correct target.

### 6. Deploy and operate it on the Pi

- Build a release bundle containing the Rust binary and frontend assets.
- Run it as a `systemd` service so it starts on boot and restarts if it exits.
- Keep the database and backups in a dedicated persistent data directory, separate from app updates.
- Give the Pi a DHCP reservation and, if available, enable local hostname discovery. Otherwise, household members can use its reserved IP address.
- Keep access restricted to the home network; do not expose the app directly to the internet.
- Back up the SQLite database regularly using a SQLite-aware backup method, and test restoring a backup.

## Suggested MVP scope

Start with account sign-in, a user's month/week/day views, personal daily items with completion, and a TV household page showing today's targets and the two streak measures for every user. Keep notes private, make the shared display and scoring rules explicit, and verify that the app runs comfortably on the Pi before adding reminders, recurring plans, or internet access.
