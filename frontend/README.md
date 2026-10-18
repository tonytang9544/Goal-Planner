# Home Planner frontend

The frontend is a React and TypeScript application built with Vite. It communicates with the Rust server through same-origin `/api` requests; Vite proxies those requests to the local server during development.

## Code organization

- `src/App.tsx` coordinates planner state and page-level flows.
- `src/components/` contains reusable UI components.
- `src/services/api.ts` owns HTTP requests, request payloads, error handling, and runtime decoding of server responses. Keep endpoint details out of presentation components.
- `src/types/planner.ts` defines the frontend's planner and API data types. These types complement—not replace—runtime validation of network data.
- Keep date-only keys (`YYYY-MM-DD`) separate from timestamps. Interpret date keys in UTC for calendar arithmetic, and use the household timezone only when converting an instant to a household-local date or displaying a due time.

The `/api` response shapes are a shared contract with `server/src/api.rs`. Update both sides together when changing a request or response. Avoid incompatible contract changes; introduce a versioned route before an incompatible API revision.

The development proxy defaults to `http://127.0.0.1:3000`. Override it with `VITE_API_PROXY_TARGET` in an ignored local environment file when the server runs elsewhere; the target must be an HTTP or HTTPS base URL and must not contain credentials.

## Development and verification

Run these commands from this directory:

```sh
npm run dev
npm run lint
npm test
npm run build
```

Tests use Node's built-in test runner and TypeScript type stripping (Node 22.18 or newer). The production build runs strict TypeScript project checks before creating static assets. Keep tests, lint, and build passing before merging frontend changes.
