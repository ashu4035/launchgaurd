# LaunchGuard feature coverage

## Implemented in the bulk audit release

- The visual-report update adds category/severity summaries, actual/expected/impact/fix cards, self-contained HTML export, and optional annotated desktop/mobile screenshots for uniquely mapped published elements. Capture is limited to two pages/four findings per scan and requires backend Chromium. Shared links hide owner-only screenshots; see VISUAL_REPORTS.md for exact limits and deployment requirements.

- Designer Extension and standalone dashboard share the audit workflow and OAuth connection.
- Select staging or a verified live custom domain, pages, collections, CMS items and checks. Inventory includes IDs, names, field definitions, locale and draft/archive state returned by Webflow.
- Saved CMS field rules handle empty strings, empty arrays, file/image values, rich text, zero and false. Draft items are checked as saved content. No checks read unsaved Designer changes.
- Published HTML title/description checks, duplicate metadata warnings, internal URL/fragment checks, PDF/ZIP/Office download signatures, image content signatures, alt-attribute/decorative exceptions, H1 structure, contact text and environment noindex policy.
- Saved CMS image/file/link resource checks are independently selectable.
- Stable findings include location, source IDs, rule/version, environment, evidence and manual fix instructions. Supported page navigation uses Designer API page objects; CMS navigation uses exact manual instructions.
- Search page, collection, item, field and finding text. Filter source, severity, status, collection and locale. Select scans from history; each scan retains its environment. Repeated resource issues can be grouped. Reports paginate at 20 rows.
- Recheck an entire stored scope or an affected CMS item/mapped page. Compare findings after a complete scope recheck; partial checks never claim resolution.
- Export JSON/CSV. CSV values are protected against formula injection. Expiring seven-day report links require OAuth access to the same site, hide draft/archive findings and can be revoked.
- Server-side queued scans persist in encrypted PostgreSQL. One scan runs at a time; duplicate active scans are rejected. Startup requeues interrupted scans with a maximum of three attempts. Findings are recomputed on recovery to avoid duplicates. Cancellation preserves incremental evidence.
- Webflow read retries handle 429/5xx, timeouts and Retry-After. Pagination failure at the inventory cap is explicit. Published scans limit pages, requests, response bytes, redirects and time.
- Public-address checks and DNS pinning protect every HTTP request and redirect. Credentials are never sent to crawled URLs. robots.txt exclusions and inaccessible responses are distinct from broken destinations.

## Exact limits

CMS inventory selection supports 2,000 items, and API pagination is capped at 10,000 results per endpoint. Saved asset checks cap at 100 requests/two minutes. Published audits default to 50 pages, cap at 100 pages/300 requests/three minutes, and read at most 2 MB per response. Limits, robots exclusions, missing publishing domains and verification failures create partial/unverified coverage rather than a complete pass.

## Still not implemented or not verified

- Lightweight checks read published HTML. Optional Rendered DOM checks run isolated Chromium for up to three pages, inspect metadata/headings and image load/alt state, proxy every HTTP read through public-address validation, block POSTs/WebSockets/WebRTC and close the browser after 18 seconds. They require server-installed Chromium plus ENABLE_RENDERED_CHECKS=true; the default free Render setup leaves them disabled. Lazy-loaded images are unverified rather than automatically broken. CSS background images and every download format are still outside this release.
- Sitemap indexes and reliable CMS-template-to-individual-item URL mapping are not implemented. URLs discovered in a flat sitemap are audited as published pages without guessing their CMS source. A selected template is not equivalent to all of its rendered CMS item pages.
- There is no dedicated multi-worker queue, relational Drizzle schema, Fastify migration or durable partial-job cursor. The existing PostgreSQL encrypted state and single-process queue remain; do not scale the Render service beyond one instance. Recovery reruns an audit rather than resuming a browser.
- Session identity uses OAuth and seven-day LaunchGuard sessions. The session restoration update can verify Designer ID tokens to recover the same bound, unexpired session; see SESSION_RESTORATION.md for required permission/configuration and live verification. History remains tied to the session, and reauthorization starts a new session. Permanent user accounts and session-history migration are not implemented.
- Shared report access is based on Webflow site authorization, not an email allowlist or invitation system. There is no account billing or organization directory.
- The expanded release passes controlled fixtures plus a bounded real staging smoke test (one published page, seven requests, three link findings, explicit partial coverage). Uploaded Designer page navigation and report access by a second real Webflow user still need manual verification. External-workspace installation remains subject to Webflow approval.
- No automatic editing, publishing, forms, purchases, AI or billing is implemented.

## Technology and validation

The release extends the existing React/TypeScript, Node HTTP server, node:test and encrypted PostgreSQL implementation. It adds maintained HTML/XML parsers and public-network validation libraries, plus Playwright end-to-end tests. It does not silently claim that the original suggested Fastify/Drizzle/Vitest architecture was delivered.

Run npm test, npm run lint, npm run build, npm run build-webpack --workspace=LaunchGuard, and npm run test:e2e after installing Playwright Chromium. See RENDER_SETUP.md for hosting and OAuth, and the SQL migration in apps/api/migrations for the current persistence schema. Enabling server browser checks requires npx playwright install --with-deps chromium during deployment and sufficient memory; validate a small scope before enabling it on free hosting.
