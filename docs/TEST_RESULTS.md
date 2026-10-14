# Test results - 2026-10-14 bulk audit release

PASS: `npm test` - 14 unit/integration tests, including IP/URL safety, resources, rich text, stable findings, authorization, report revocation and persisted queue recovery.
PASS: `npm run build` - TypeScript and hosted dashboard production build.
PASS: Designer Extension production webpack build.
PASS: `npm run test:e2e` - 3 Chromium tests: isolated dynamic DOM inspection with WebRTC disabled, plus audit/search/details/history workflows at 800x600 and 320x460; screenshots inspected for clipping and overlap.

REAL SMOKE TEST: Authorized staging site audit checked one published page with seven HTTP requests. Three internal-link findings were returned; skipped targets made coverage explicitly partial. No content was edited or published.

NOT VERIFIED: Newly uploaded Designer navigation, native ID-token identity, cross-user shared report access and multi-instance operation. Database encryption is tested locally; no new live PostgreSQL credentials were available in this workspace. Existing hosted PostgreSQL setup is preserved. See FEATURE_COVERAGE.md for exact limits and missing architecture/browser features.
