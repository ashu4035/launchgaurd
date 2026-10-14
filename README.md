# LaunchGuard - Hybrid development
A Webflow auditing app with a standalone React dashboard and a Designer Extension sharing one audit interface and backend. Bulk audits cover saved CMS fields/assets and published HTML metadata, internal links, downloads, images, headings, alternative text and environment indexing policies. Scope selection, progress, search/filters, issue details, rechecks, history, CSV/JSON export and access-controlled report links are implemented. Read [feature coverage and limitations](docs/FEATURE_COVERAGE.md) and [Render setup](docs/RENDER_SETUP.md).

## Local start
Use Node 22.22.2 or later. Run `npm ci`, configure `.env` using `.env.example`, and start `npm run api` plus `npm run dev`. `npm test` runs unit/integration tests; `npm run build` type-checks and builds the dashboard. `npm run build-webpack --workspace=LaunchGuard` builds the Designer Extension. `npm run test:e2e` runs Chromium workflows after `npx playwright install chromium`. For the uploaded extension, run `npm run bundle` from apps/webflow-extension and upload bundle.zip.

## Structure
- `apps/designer`: standalone React / TypeScript dashboard; original fixture UI retained in `src/main.tsx`
- `apps/webflow-extension`: Designer entry point using the current Webflow site
- `apps/api`: API, OAuth, encrypted PostgreSQL state, embedded recoverable audit queue and safe HTTP checks
- `apps/worker`: reserved for a future dedicated worker; currently audits run in the API service
- `packages/ui`: shared audit interface
- `packages/checks`: pure rule functions and tests
- `tests/fixtures`: synthetic Services collection
- `docs/WEBFLOW_SETUP.md`: registration, OAuth and test-site setup

## Verified platform facts vs limitations
The app has been uploaded and launched in a real Webflow Designer session during setup. The bulk-audit release additionally passed a bounded, read-only staging smoke test: one published page, seven HTTP requests, three internal-link findings and explicit partial coverage. The new uploaded UI, page-navigation actions and shared reports still need manual Designer verification. No Webflow content is automatically edited or published.

## Roadmap
1. Prototype UI with fixtures (this release).
2. Official extension scaffold, backend, secure OAuth, site authorization and one real required CMS-field check.
3. Database, resilient queue and paginated real scans.
4. Rendered metadata, links, downloads, images and safe crawling.
5. Report search, grouping, history, authenticated report sharing and comprehensive tests.

Never paste credentials into chat. See `docs/WEBFLOW_SETUP.md`.

## Current test results
`npm test`: 14 passed. Three Playwright tests pass, including isolated dynamic DOM and end-to-end workflows at 800x600 and 320x460. Lint, dashboard and extension webpack production builds pass. See `docs/TEST_RESULTS.md`. Historical milestone documents describe earlier prototypes; `docs/FEATURE_COVERAGE.md` records the current capabilities and remaining gaps.
