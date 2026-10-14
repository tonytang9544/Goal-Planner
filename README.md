# Home Month Planner

A local-first household planner for a Raspberry Pi, accessed from browsers on the home Wi-Fi. The intended planner organizes each user's plans by month, week, and day, with a household progress chart. The Rust API currently has a health endpoint and planner data models; accounts, API integration, and persistence are planned next.

The frontend includes a month/week/day planner prototype with personal sample plans, completion controls, editing, date changes, keyboard-accessible reordering, and a TV summary view. The visible profile and plans are previews; planner data is currently held in browser memory, and account sign-in, household competition charts, and persistence are not implemented yet.

## Requirements

- Node.js and npm
- Rust toolchain (`rustc` and `cargo`)

## Start locally

Open two terminals from the project root.

**1. Start the frontend:**

```sh
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

Open the URL printed by Vite (usually `http://localhost:5173`) in a browser. The `--host 0.0.0.0` option allows other devices on your local network to reach the development server using this computer's LAN IP address.

**2. Start the Rust API:**

```sh
cd server
cargo run
```

The API listens on port `3000`. Check that it is running at `http://localhost:3000/api/health`; it should return:

```json
{"status":"ok"}
```

The frontend and API currently run separately in development. API proxying and serving the built frontend from the Rust server are not configured yet.
