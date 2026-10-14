# LaunchGuard - Hybrid development
A Webflow auditing app with a standalone React dashboard and a Designer Extension sharing one audit interface and backend. Current checks cover configured CMS required fields and Webflow page SEO settings, with scan progress, cancellation and saved history. See [the current local setup](docs/HYBRID_LOCAL.md). Live Webflow and Designer execution still require account setup and validation.

## Local start
Node 22.13+ recommended. Run `npm install` (which generates `package-lock.json` if missing), then `npm run dev`. Open the local URL provided by Vite. Use `npm test` for pure check tests and `npm run build` for TypeScript + production frontend build.

## Structure
- `apps/designer`: standalone React / TypeScript dashboard; original fixture UI retained in `src/main.tsx`
- `apps/webflow-extension`: Designer entry point using the current Webflow site
- `apps/api`: local API, token/OAuth routes, scanning and JSON history
- `apps/worker`: future durable queue
- `packages/ui`: shared audit interface
- `packages/checks`: pure rule functions and tests
- `tests/fixtures`: synthetic Services collection
- `docs/WEBFLOW_SETUP.md`: registration, OAuth and test-site setup

## Verified platform facts vs limitations
Webflow lists available test sites and CMS collections via the connected app; the site exposed in this environment has a **Blog Posts** collection, not Services. Official Webflow docs confirm the React CLI extension scaffold, a Designer launch workflow, HTTPS OAuth redirect requirement and least-privilege scopes. Current sandbox could not fetch the CLI scaffold, so the UI is a browser-run prototype and is **not verified inside Designer**. No live site has been modified.

## Roadmap
1. Prototype UI with fixtures (this release).
2. Official extension scaffold, backend, secure OAuth, site authorization and one real required CMS-field check.
3. Database, resilient queue and paginated real scans.
4. Rendered metadata, links, downloads, images and safe crawling.
5. Report search, grouping, history, authenticated report sharing and comprehensive tests.

Never paste credentials into chat. See `docs/WEBFLOW_SETUP.md`.

## Current test results
`npm test`: 6 passed, including a mocked Webflow API integration test. Dashboard and extension webpack production builds pass. Historical milestone notes below and in older documents describe the original prototype; `docs/HYBRID_LOCAL.md` records current limitations.
