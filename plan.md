# Jira Board-Like Home App: Implementation Plan

## Recommended architecture

```text
Phones / laptops / TV browser
            │  HTTP on home Wi-Fi
            ▼
Raspberry Pi 2
  ├── Rust server: REST API + serves the built frontend
  └── SQLite database: board data
```

- **Frontend:** TypeScript with React and Vite. Build it into static files and serve them from the backend, so there is one service and one address to maintain.
- **Backend:** Rust, using a lightweight web framework such as Axum. Compile it to a small ARM Linux binary, avoiding a separate runtime and keeping memory use modest.
- **Database:** SQLite stored on the Pi's SD card. For a single household board, it should be ample and needs no separate database server.
- **Updates:** Start with short-interval polling for board changes. It is simpler to operate than WebSockets and likely sufficient for a home board.

## Implementation plan

### 1. Set up the app and data model

- Create a React/TypeScript frontend and Rust API.
- Model boards, columns, cards, labels, and activity timestamps.
- Start with one board; leave room to add more later.
- Store card ordering explicitly so drag-and-drop changes persist.

### 2. Build the core board experience

- Show columns and cards in a responsive layout that works on phones, laptops, and a TV browser.
- Add, edit, delete, and move cards; support drag-and-drop and a keyboard-accessible alternative.
- Include practical card fields such as title, description, labels, due date, and completion status.
- Make the board readable from across a room: clear text, restrained controls, and an optional full-screen view.

### 3. Add the API and persistence

- Provide REST endpoints for boards, columns, and cards.
- Validate requests in the backend and persist each change in SQLite.
- Use database migrations so the schema can evolve without losing board data.
- Add polling so changes made on one device appear on the others.

### 4. Test the important behaviors

- Unit-test ordering, validation, and data operations.
- Test API operations against a temporary SQLite database.
- Check the built frontend at phone, desktop, and TV-sized resolutions.
- Verify the release binary and frontend build on the Pi's actual OS and architecture; the Pi 2 model and OS image can affect the correct target.

### 5. Deploy and operate it on the Pi

- Build a release bundle containing the Rust binary and frontend assets.
- Run it as a `systemd` service so it starts on boot and restarts if it exits.
- Keep the database and backups in a dedicated persistent data directory, separate from app updates.
- Give the Pi a DHCP reservation and, if available, enable local hostname discovery. Otherwise, household members can use its reserved IP address.
- Back up the SQLite database regularly using a SQLite-aware backup method, and test restoring a backup.

### 6. Keep access local

- Make the app available on the home network only; do not expose it to the internet by default.
- For a trusted household network, the MVP can allow access without individual accounts. If guests or less-trusted devices use the Wi-Fi, add a shared PIN or user accounts before relying on it for private content.

## Suggested MVP scope

Start with a single board and verify that it runs comfortably on the Pi before adding features such as multiple boards, comments, notifications, or individual users.
