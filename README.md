# Jira TV

A lightweight, local-first shared board app for a household, designed to run on a Raspberry Pi and be accessed from a browser on the home Wi-Fi. It has a React/TypeScript board interface and a Rust API health endpoint. Board edits currently live in frontend memory and reset when the page reloads; API integration and persistence are planned next.

The board UI includes sample household cards, add/edit/delete, labels, due dates, completion status, drag-and-drop, keyboard-accessible move and reorder controls, and a TV presentation mode.

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
