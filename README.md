# Home Month Planner

A local-first household planner for a Raspberry Pi, accessed through browsers on home Wi-Fi. Each person has a private month/week/day planner; the shared TV view displays household members' daily target titles and progress streaks.

## Requirements

- Node.js and npm
- Rust toolchain (`rustc` and `cargo`)

## Start locally

Open two terminals from the project root.

**1. Start the Rust API and SQLite database:**

```sh
cd server
HOUSEHOLD_TIMEZONE=Europe/London cargo run
```

The server listens on `http://localhost:3000`. On first run it creates the SQLite database at `<project folder>/server/data/planner.db` and applies database migrations automatically. This is a relative path resolved from the `server` directory because the command above runs Cargo there. Set `DATABASE_PATH` to choose another location; an absolute path is recommended if the server may be launched from a different working directory. `HOUSEHOLD_TIMEZONE` must be a valid IANA timezone name; if omitted, it defaults to `UTC`. Set `BIND_ADDRESS` to change the listen address.

**2. Start the frontend:**

```sh
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

Open the planner at the URL printed by Vite (usually `http://localhost:5173`). The read-only TV display is available directly at `/tv` (usually `http://localhost:5173/tv`); it does not require signing in and has no planner controls. A button in the TV header switches between today's household targets and a competition view, with weekly/monthly completion percentages and streak-based rankings. Vite proxies `/api` requests to the Rust server. Other devices on the home network can use this computer's LAN IP address and port `5173`, adding `/tv` on the TV.

Create the first account from the sign-in page. Registration is currently open to devices that can reach the app, so only run it on a trusted home network. Accounts have private plans; the shared TV page and its summary APIs intentionally display every household member's daily target titles, completion status, progress streaks, and competition totals without authentication. Closed-day competition scores are recorded as of the end of each household-local day, so later changes do not rewrite those scores; today's score updates live.

## Current scope

Accounts use Argon2id password hashes and opaque, HTTP-only, same-site session cookies that expire after 14 days. The API scopes plan reads and writes to the signed-in user. Plans, completion changes, and historical plan snapshots are stored in SQLite. The planner and TV view poll the server every 15 seconds.

Signed-in users can open `/accounts` from the planner to view household accounts and permanently remove another account. An account deletion also removes that user's sessions, plans, and progress history through SQLite foreign-key cascades in a transaction. The currently signed-in account cannot be removed from this page. This permission is shared by all signed-in users, not limited to an administrator.

The project does not yet include account invitations/admin controls, a competition ranking chart, recurring plans, or internet-facing deployment. Keep the server restricted to the home network.
