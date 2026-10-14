# Render deployment preparation

## Current state

The Render service now serves both the dashboard and API. Hosted OAuth requires PostgreSQL via DATABASE_URL and a 64-character hex TOKEN_ENCRYPTION_KEY. State, sessions, Webflow tokens and scan history are encrypted with AES-256-GCM before being stored. Local development without DATABASE_URL still uses JSON and a local site token. Hosted OAuth is disabled until persistent storage is configured.

## Repository

Create a private GitHub repository named `launchguard` and push this project. Exclude `.env`, local data, logs and node_modules. Review staged files before the first commit. Do not include Webflow credentials.

## Render service settings

Create a Node Web Service and connect the repository. Keep the root directory empty (repository root).

| Setting | Value |
| --- | --- |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check | `/health` |
| Instance | Free, for development testing |

Set `NODE_ENV=production`, `HOST=0.0.0.0`, and Node 22.22.2. Render provides `PORT`; do not copy local PORT=8787. Set PUBLIC_BASE_URL to the actual HTTPS service address, without a trailing slash. Keep WEBFLOW_CLIENT_ID and WEBFLOW_CLIENT_SECRET in Render environment settings.

Set DATABASE_URL to a PostgreSQL connection string (Neon is one option; use the SSL-enabled connection string supplied by your provider). Run `node scripts/generate-render-key.mjs` locally to generate `.env.render-key`, which Git ignores. Copy only its value directly into TOKEN_ENCRYPTION_KEY in Render. Keep the key stable across redeployments: changing it makes saved data unreadable.

The production dashboard is served at PUBLIC_BASE_URL and OAuth redirects there even if an old FRONTEND_ORIGIN points to localhost. Remove that old variable for clarity. Configure exact extension origins in ALLOWED_ORIGINS: include `http://localhost:1337` for local extension testing and the origin of Webflow's Designer Extension URI for the uploaded extension. Never use a wildcard and never set WEBFLOW_SITE_API_TOKEN on Render. `/health` returns storageReady=true only once persistent storage is configured.

## Webflow configuration

Enable both Designer Extension and Data Client capabilities, with sites, CMS and pages read scopes. Register the exact URL `https://launchgaurd.onrender.com/auth/callback`. Begin OAuth at `/auth/start`, not by visiting a callback containing an old code. Approval and denial validate the initiating browser's state cookie.

`npm run build-webpack` in apps/webflow-extension produces a hosted build using https://launchgaurd.onrender.com; LAUNCHGUARD_API_URL can override it at build time. `npm run watch-webpack` continues to use the local backend. Run `npm run bundle` to produce bundle.zip for Webflow's Publish extension version screen. Use Launch App for an uploaded version. The extension opens OAuth in a popup and receives an expiring LaunchGuard session through postMessage after checking the sender origin and popup window; Webflow's API token stays on the server. Keep popups enabled for this flow.

## Operational limits and verification

Run one service instance. Persistent snapshots use an optimistic revision check to refuse concurrent stale writes; this is not a multi-instance database architecture. Render Free can restart or sleep mid-scan. Interrupted scans are marked failed on startup so users can rerun them; automatic resumable jobs are not implemented. Sessions expire after seven days, and scan history is tied to that session. Reauthorizing creates a new session.

Tests cover encryption integrity, browser-bound OAuth state, replay rejection, the cookie dashboard session, popup handoff, bearer-session revocation, site authorization and audit results against mocked Webflow. Live PostgreSQL and the uploaded Designer execution still require verification after account configuration. Do not describe this as Marketplace-ready.
