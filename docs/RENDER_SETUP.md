# Render deployment preparation

## Current state

Local Designer audits work. The code is not yet ready for public OAuth: persistent database storage, encrypted token storage and authenticated Designer sessions still need implementation. Do not expose the local site token on a hosted service. The current JSON file is not durable on Render Free.

## Repository

Create a private GitHub repository named `launchguard` and push this project. Exclude `.env`, local data, logs and node_modules. Review staged files before the first commit. Do not include Webflow credentials.

## Render service settings (after the remaining OAuth work)

Create a Node Web Service and connect the repository. Keep the root directory empty (repository root).

| Setting | Value |
| --- | --- |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check | `/health` |
| Instance | Free, for development testing |

Set `NODE_ENV=production`, `HOST=0.0.0.0`, and Node 22.22.2. Render provides `PORT`; do not copy local PORT=8787. Set PUBLIC_BASE_URL to the actual HTTPS service address, without a trailing slash. Keep WEBFLOW_CLIENT_ID and WEBFLOW_CLIENT_SECRET in Render environment settings.

Once an external persistent database is implemented and configured, set the dashboard URL in FRONTEND_ORIGIN and configure exact client origins in ALLOWED_ORIGINS. Never set WEBFLOW_SITE_API_TOKEN on Render.

## Webflow configuration

Enable both Designer Extension and Data Client capabilities, with sites, CMS and pages read scopes. Register the exact URL `https://YOUR-SERVICE.onrender.com/auth/callback`. Replace the extension's development API address with the hosted address after implementing its authenticated session flow, then upload its bundle.

Render Free sleeps after inactivity and can restart, so jobs also need a recovery strategy. First validate OAuth approval, denial, session expiry and site isolation before distributing the app.
