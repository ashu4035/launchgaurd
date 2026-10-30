# LaunchGuard: Hosting, Database Migration and Handover

Prepared: 2026-10-15. Applies to the current 0.4.0 runtime. Recheck the source before migrating a later release. This is a runbook, not confirmation that any migration has been performed.

## 1. The five things to remember

1. Back up the PostgreSQL database AND the existing `TOKEN_ENCRYPTION_KEY`. Without the matching key, the encrypted database cannot be read. Generating a replacement key does not recover it.
2. Run exactly one API process/instance. Stop the old writer before starting the new writer. Do not use overlapping rolling deployments, multiple PM2 workers or autoscaling.
3. The app needs a persistent Node server, not static-only hosting. The same server serves the dashboard, API and OAuth callbacks.
4. A backend hostname change requires coordinated OAuth, frontend extension and report-link updates. Changing `PUBLIC_BASE_URL` alone is not enough.
5. Keep the same Webflow app/client identity. Moving hosting does not require users' passwords, individual site tokens or manually entered site IDs.

## 2. System overview

```text
Webflow Designer -> Webflow-hosted extension bundle --+
                                                     +-> Node API -> Webflow Data API
Browser -> dashboard served by the Node API ----------+        |
                                                              +-> PostgreSQL encrypted snapshot
                                                              +-> public published pages/assets
```

| Component | Location / responsibility |
| --- | --- |
| Repository | https://github.com/ashu4035/launchgaurd |
| Current dashboard/API | https://launchgaurd.onrender.com |
| Current database | Neon PostgreSQL; actual connection details belong in the secret manager |
| Uploaded extension origin | https://6acf0bd2d8d0251682f2aefc.webflow-ext.com |
| API/OAuth/queue | `apps/api/src/server.js` |
| Encryption/storage | `apps/api/src/storage.js` |
| Database schema | `apps/api/migrations/001-state.sql` |
| Shared application UI | `packages/ui/AuditApp.tsx` |
| Hosted UI entry/build | `apps/designer/src/live.tsx`, output `apps/designer/dist` |
| Designer entry/build | `apps/webflow-extension/src/index.tsx`, `webpack.config.mjs` |

The Webflow-hosted ZIP and the Node service are separate deployments. Deploying the backend does not publish a new Designer Extension. Webflow hosts website content and uploaded assets; the LaunchGuard database stores audit/session information, not copies of the customer's complete website or original media files.

## 3. What the database contains

The current schema is one table, normally in `public`:

```sql
CREATE TABLE launchguard_state (
  id integer PRIMARY KEY CHECK (id = 1),
  payload text NOT NULL,
  revision integer NOT NULL DEFAULT 0
);
```

The row `id=1` contains a base64 AES-256-GCM encrypted JSON snapshot. It holds sessions (including Webflow access tokens), pending OAuth states and scans (scope, findings, history and sharing state). The IV and authentication tag are stored in the encrypted payload. `revision` detects stale writers; it does not merge concurrent updates.

Preserve `id`, `payload` and `revision` together. Do not edit ciphertext, reset revision, merge snapshots or attempt SQL queries against individual findings. Startup creates an empty row if none exists, so starting against an empty database can look healthy while all previous history is absent.

History belongs to a seven-day LaunchGuard session, not a durable user account. Reauthorization creates a new session; older history does not automatically attach to it. A successful database move does not extend session lifetimes. Pending OAuth transactions expire after ten minutes and should be restarted after a cutover.

Local development without `DATABASE_URL` uses `LAUNCHGUARD_DB`, default `./data/launchguard.json`, as plaintext JSON. This is NOT a production database backup and is not automatically imported into PostgreSQL. Protect it as sensitive data. Production OAuth requires PostgreSQL.

## 4. Hosting requirements

- Node.js 22.22.2 or later compatible with this lockfile, npm and the complete repository/workspace layout. Prefer the same tested Node version during a migration.
- A persistent HTTP process with HTTPS at its public hostname. A VPS, container or managed Node web service can work; static hosting alone cannot. Short-lived/serverless functions are not a drop-in replacement for the in-process audit queue.
- Exactly one application process and one replica. The whole snapshot is loaded in memory. Size memory for actual history and concurrent request load; there is no established production capacity benchmark.
- Outbound access to PostgreSQL, DNS, `api.webflow.com`, `webflow.com` and public website/assets being audited. Public URLs pointing into private networks remain intentionally blocked.
- Database TLS certificate verification and appropriate firewall/network access from the new host. Do not fix TLS failures by disabling certificate validation.
- Background process uptime long enough for bounded audits. Sleep/restarts can interrupt jobs. Startup retries queued/running jobs up to three total attempts, recomputing findings rather than resuming a durable cursor.
- Health checks on `/health`, secret storage, logs with credential redaction, and database backups.

Optional `Rendered DOM` checks additionally require Playwright Chromium, Linux browser dependencies and sufficient memory. Install using `npx playwright install --with-deps chromium` in a compatible build/runtime image and ensure that the browser cache exists at runtime. Leave `ENABLE_RENDERED_CHECKS=false` until a small hosted scan is verified. Ordinary HTML/CMS checks do not require Chromium.

## 5. Environment variable reference

Never put real credentials in this document, Git, screenshots, the ZIP or frontend build variables.

| Variable | Production value / migration action |
| --- | --- |
| `NODE_ENV` | `production`. Required to avoid development-token behavior. |
| `HOST` | `0.0.0.0` inside a hosted service/container; protect it behind the platform proxy/firewall. |
| `PORT` | Use the host's supplied port; on a VPS choose a private application port and proxy HTTPS to it. Defaults to 8787 if absent. |
| `PUBLIC_BASE_URL` | Exact external HTTPS origin, no trailing slash or subpath, e.g. `https://audit.example.com`. Set explicitly on every provider. |
| `DATABASE_URL` | New PostgreSQL connection string, including provider-required TLS parameters. Secret. |
| `TOKEN_ENCRYPTION_KEY` | EXACT existing 64-character hexadecimal key. Secret. Never regenerate during a migration. |
| `WEBFLOW_CLIENT_ID` | Existing LaunchGuard app client ID, not a site/workspace ID. |
| `WEBFLOW_CLIENT_SECRET` | Existing app secret, backend only. Preserve unless intentionally rotating it separately. |
| `ALLOWED_ORIGINS` | Comma-separated exact browser origins. Include the uploaded Webflow extension origin, without a path/trailing slash. No wildcard. Add localhost only for deliberate testing. The backend's own origin is included automatically. |
| `ENABLE_RENDERED_CHECKS` | `false` unless Chromium is provisioned and verified. |
| `WEBFLOW_IDENTITY_ENABLED` | `true` only after enabling Authorized User: Read and deploying the session-restoration backend and ZIP. Otherwise leave false/absent. See SESSION_RESTORATION.md. |
| `FRONTEND_ORIGIN` | Development-only; production dashboard/OAuth return uses `PUBLIC_BASE_URL`. Remove stale localhost settings for clarity. |
| `LAUNCHGUARD_DB` | Development JSON path; not the production storage location. |
| `WEBFLOW_SITE_API_TOKEN` | Local development only. Do not configure on the hosted service. |
| `RENDER_EXTERNAL_URL` | Render fallback only. Not needed when `PUBLIC_BASE_URL` is explicitly set. |
| `LAUNCHGUARD_API_URL` | Extension BUILD-TIME variable, not a server runtime setting. Set when rebuilding the ZIP for another backend hostname. |

Example settings (placeholders only):

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PUBLIC_BASE_URL=https://audit.example.com
DATABASE_URL=<new-provider-secret-connection-string>
TOKEN_ENCRYPTION_KEY=<existing-64-hex-character-key>
WEBFLOW_CLIENT_ID=<existing-app-client-id>
WEBFLOW_CLIENT_SECRET=<existing-app-secret>
ALLOWED_ORIGINS=https://6acf0bd2d8d0251682f2aefc.webflow-ext.com
ENABLE_RENDERED_CHECKS=false
```

`npm start` does not load a repository `.env` file. Configure the process environment through the hosting provider/service manager. `npm run api` explicitly loads `.env` for development; do not substitute it for the production start command.

## 6. Migration decision table

| What changes? | Required work |
| --- | --- |
| Database only | Final backup/restore while writers are stopped; update `DATABASE_URL`; retain key, code and public hostname. No extension rebuild or OAuth URL change. |
| App host only, same database and public custom domain | Stop old app; start one new app with same secrets; move domain/proxy. Usually no extension rebuild or OAuth change because public origin stays identical. |
| App hostname changes | Update `PUBLIC_BASE_URL`, Webflow redirect/homepage/install entry points, extension API build, bookmarks and shared-report URLs. Expect reconnection. |
| Database and app host | Perform both procedures in one planned maintenance window, initially using the same code release. |

A custom domain under your control reduces future coupling to provider-specific hostnames, but switching to it for the first time is itself a hostname migration. Subpath hosting (e.g. `/launchguard`) is not supported by the current root-relative routes without code changes.

## 7. Before you start

- Record the source commit, Node version, source PostgreSQL version, target version and current Webflow app settings. Keep the old code artifact and uploaded extension ZIP.
- Confirm administrative access to GitHub, source/target hosting, source/target databases, Webflow's app-owning workspace and DNS if applicable. Transfer account access through invitations, not shared passwords.
- Export secrets into an encrypted password vault. Keep the encryption key in a separately protected backup with a clear reference to the matching database backup. Record ownership and recovery access.
- Create a target PostgreSQL database dedicated to LaunchGuard. Use a target server of the same supported major version or a compatible newer version; rehearse cross-version restores. Do not assume downgrades work.
- Use a `pg_dump` client at least as new as the source server (ideally matching it) and a matching/newer compatible `pg_restore`. Prefer direct/non-transaction-pooled administrative endpoints for dump and restore; the runtime can use a provider-supported pooled URL.
- Restore a rehearsal backup to a disposable database first. Never launch a second app against the live source database. An app started on a copied database can automatically rerun queued jobs and perform Webflow reads, so leave rehearsal app processes off until that behavior is acceptable.
- Plan maintenance and a rollback deadline. Wait for audits to finish and prevent new logins/scans. There is no built-in maintenance/read-only switch: use the hosting platform/proxy to restrict traffic, then stop the app.

## 8. Database migration: safe backup and restore

The commands below run on an administrator's computer with PostgreSQL client tools installed. PowerShell examples assume `PGSERVICE=launchguard-source` / `launchguard-target` service profiles and a protected PostgreSQL password file are already configured using your provider's host, database, user and TLS settings. The profile names are examples, not profiles supplied by this repository. This avoids placing passwords in shell history or command arguments. Never echo connection strings or use a pipeline that exports secret values into logs.

1. Finish/cancel active scans, restrict incoming traffic and stop ALL LaunchGuard API processes, including local processes connected to production. Stopping scans alone is insufficient: OAuth and report creation also write state.
2. Verify the stopped source using an administrative SQL connection; do not select `payload` into a shared terminal:

```sql
SELECT version();
SELECT id, revision, octet_length(payload) AS encrypted_bytes
FROM public.launchguard_state;
```

Expect exactly one row with `id=1`. Record revision/byte count privately. If the table is in another schema, adjust all schema references after verifying the actual schema/search path.

3. Create the FINAL backup after the writer stops. Choose a protected existing backup directory outside the repo and a unique filename:

```powershell
$env:PGSERVICE = 'launchguard-source'
pg_dump --format=custom --table=public.launchguard_state --file='C:\secure-backups\launchguard-final.dump'
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; do not continue.' }
pg_restore --list 'C:\secure-backups\launchguard-final.dump'
if ($LASTEXITCODE -ne 0) { throw 'Archive is not readable; do not continue.' }
Get-FileHash -Algorithm SHA256 'C:\secure-backups\launchguard-final.dump'
```

The table-only archive covers the current app schema, not other applications/roles/database settings. Reassess when the schema expands. Also use provider snapshots/full-database backups where available. Listing an archive and hashing it do not prove restore or decryption works.

4. Restore into a NEW EMPTY dedicated target database, before starting LaunchGuard there:

```powershell
$env:PGSERVICE = 'launchguard-target'
pg_restore --dbname='service=launchguard-target' --no-owner --no-acl --exit-on-error --single-transaction 'C:\secure-backups\launchguard-final.dump'
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; keep the old deployment stopped and investigate.' }
Remove-Item Env:PGSERVICE
```

Do not use `--clean`, drop tables or overwrite a database containing newer production data. If the target app already initialized an empty table, stop it and use a fresh empty target database rather than blindly restoring over it. `--no-owner --no-acl` avoids copying provider-specific ownership/grants; ensure the target runtime role has schema access plus table SELECT/INSERT/UPDATE and permission for the startup initialization as required. No superuser is needed for normal app operation.

5. Run the same safe SQL on the target and compare row count, id, revision and encrypted byte count with the source. Retain the archive checksum and timestamp. A complete encrypted payload comparison may be done privately by an administrator; never print token-containing decrypted state.
6. Set target `DATABASE_URL` and the EXACT original `TOKEN_ENCRYPTION_KEY` on the new/remaining service. Keep the same app code version for the first startup.
7. Start only that service. A wrong key causes authenticated decryption/startup failure. Verify health, logs and actual authenticated access before reopening traffic. Health alone does not prove that a particular user's history exists.

The application does not ship a key-rotation or plaintext-JSON-to-PostgreSQL import tool. Treat either as a separate engineering task, not a database hosting migration.

## 9. Deploying the app on a new host

1. Connect the repository or upload a clean checkout at the recorded release commit. Preserve the full monorepo layout. Exclude `.env*` secrets, local `data`, logs, `node_modules` and test artifacts; `.env.example` is safe as a template.
2. Configure the variables from section 5 using the host's secret settings. Use the repository root as the working directory.
3. Build on the host (or produce the same artifact in CI):

```text
npm ci --include=dev
npm run build
```

Development dependencies are required DURING BUILD for TypeScript/Vite, even with `NODE_ENV=production`. Verify that `apps/designer/dist/index.html` and its assets are included in the deployed runtime artifact. Deploying only `apps/api` is insufficient unless packaging explicitly includes its dependencies and the dashboard at the expected relative path.

4. Start with `npm start`, one process. On a VPS use a service manager with restart-on-failure and an HTTPS reverse proxy. Forward `/`, `/assets/*`, `/api/*` and `/auth/*` to Node without rewriting the paths. Preserve cookies, Authorization headers and Origin headers. Disable shared caching of API/auth responses. Check that popup OAuth is not broken by custom cross-origin isolation headers.
5. Point the platform's health check at `/health`. Expected for this release:

```json
{"ok":true,"version":"0.4.0","storageReady":true}
```

This checks process/storage initialization, not a continuous DB round-trip or a real Webflow audit. Monitor actual requests and persistence errors too.
6. If retaining a domain, configure target TLS before DNS cutover and stop the source writer before target startup. Cached DNS must not send users to a still-writing old instance. Prefer a maintenance response on the old endpoint rather than two live writers.

## 10. If the backend URL changes

For example, moving from `https://launchgaurd.onrender.com` to `https://audit.example.com`:

1. Set `PUBLIC_BASE_URL=https://audit.example.com` on the target server.
2. In the EXISTING Webflow app's Data Client/OAuth configuration, register the exact redirect `https://audit.example.com/auth/callback`. Preserve `sites:read cms:read pages:read` scopes and the existing client identity. If settings permit multiple redirects, retain the old one only for the transition/rollback window. The generated redirect must exactly match the registered redirect. See [Webflow OAuth documentation](https://developers.webflow.com/data/reference/oauth-app).
3. Update the app homepage and any custom install/connect links to the new origin. Start connection through the app or `/auth/start`; never copy an old callback URL with its one-time code/state.
4. Keep the Webflow-hosted extension URI in `ALLOWED_ORIGINS`. This is the UI's origin, NOT the new API hostname. If Webflow issues a different extension URI, allow that exact new origin too and retire the old one after the transition.
5. Rebuild the Designer Extension with the NEW API URL. From the repository root in PowerShell:

```powershell
$env:LAUNCHGUARD_API_URL = 'https://audit.example.com'
npm run build-webpack --workspace=LaunchGuard
if ($LASTEXITCODE -ne 0) { throw 'Extension build failed.' }
npm run bundle --workspace=LaunchGuard
if ($LASTEXITCODE -ne 0) { throw 'Extension bundle failed.' }
Remove-Item Env:LAUNCHGUARD_API_URL
```

The current `serve.cjs` bundle wrapper expects a globally installed Webflow CLI at a Windows npm path. Run this on the existing Windows development machine with that CLI installed. On Linux/macOS the wrapper needs adaptation, or use a verified Webflow CLI's `webflow extension bundle` from `apps/webflow-extension` after webpack. Backend deployment does not need this Windows wrapper.

IMPORTANT: A production webpack build defaults to the OLD Render URL unless `LAUNCHGUARD_API_URL` is supplied. A development watch build defaults to localhost and may overwrite `public/bundle.js`. Stop watchers, build production last, verify the compiled endpoint, and then package. Setting this variable on the running API does not change an already uploaded ZIP. Never put client secrets, database URLs or the encryption key into webpack variables.

6. Upload `apps/webflow-extension/bundle.zip` in Webflow: original app-owning workspace > Apps & Integrations > Develop > LaunchGuard > Publish extension version. Use release notes and the distribution appropriate to the current testing/review status. Launch the uploaded version with **Launch App**, not the localhost development button.
7. Ask users to reconnect if necessary. Browser cookies are hostname-bound. Older extension versions used temporary session storage namespaced by API base URL. The session-restoration update uses server-verified Designer identity and in-memory sessions instead; retain identity bindings in the database and enable the flag/permission as described in SESSION_RESTORATION.md. Old cookies/state are not transferred just by copying the database. Reauthorization currently creates a new session, which affects history visibility.
8. Update saved report links. Stored report tokens may remain usable at the new `/?report=TOKEN` URL until expiry if the database is retained and the viewer has site access, but old absolute URLs still point to the old host. Do not redirect in-flight OAuth callbacks blindly; restart login instead. Do not leave an old credential-bearing API domain abandoned without a retirement plan.

Prefer moving the same Webflow app rather than creating another. External testing approval/Marketplace status and user site permissions are controlled by Webflow, not by the hosting/database provider. Adding a new user's workspace still requires their own OAuth authorization; migration does not grant access to extra sites.

## 11. Acceptance checklist before reopening traffic

- [ ] Exactly one API writer is active; no local service, preview deployment or old replica points to production storage.
- [ ] `/health` shows the expected version and `storageReady:true`; startup logs contain no decryption, DB, TLS or stale revision error.
- [ ] `/` serves the actual dashboard and `/assets/*` loads successfully, without localhost references.
- [ ] Fresh OAuth starts at the target host and returns to its exact callback. No missing state, redirect mismatch or token exchange error.
- [ ] Designer extension launches the uploaded production ZIP, popup connection works and the authorized current site loads.
- [ ] With a still-valid existing session, known scan/history evidence is present where expected; do not mistake a new session's empty history for successful preservation.
- [ ] Run a small read-only scan, inspect its findings, restart the service, then verify persisted results with the same valid session. Do not publish/edit a customer's site for this test.
- [ ] Report creation, authorized viewing and revocation work; unauthorized visitors cannot read the report. Verify export files privately.
- [ ] Check a second approved Webflow test account/site where available. External account approval is separate from technical deployment.
- [ ] Disabled Chromium reports unverified coverage rather than false success; if enabled, a small browser scan works within resource limits.
- [ ] Backup archive, checksum, exact encryption key, old release artifact and rollback contacts are secured.

## 12. Rollback without losing new data

If the target has NOT accepted any writes: stop it, restore old DNS/OAuth settings/extension endpoint if changed, confirm the source DB is the retained final snapshot, then start ONE old service. Use the same encryption key. Fresh OAuth may be necessary.

If the target HAS accepted writes: stop traffic and the target writer, take a fresh target backup, and decide whether to move that newer state back to a compatible old-code/database environment. Blindly starting the old database discards new sessions, scans and revocations. There is no built-in snapshot merge; obtain engineering help if schemas/code differ. Do not overwrite newer data with the original migration archive without explicit approval of the data loss.

Avoid an irreversible app/schema upgrade during a hosting move. Keep the retained source database/service offline and protected until the acceptance window closes. Retire old credentials/endpoints deliberately after backups and rollback needs are reviewed.

## 13. Troubleshooting

| Symptom | Check / action |
| --- | --- |
| Port scan timeout / unreachable service | `HOST=0.0.0.0`, platform `PORT`, firewall and proxy target. |
| Dashboard not built | Run `npm ci --include=dev` then `npm run build`; include `apps/designer/dist` in runtime. |
| Missing `vite/client` or build tools | Production install omitted development dependencies during build. |
| `storageReady:false` | Production `DATABASE_URL` missing. This endpoint can still return HTTP 200; inspect the body. |
| Invalid encryption key / authentication-tag error at startup | Verify exact existing key and matching backup. Do not replace the key or wipe the table. |
| DB connection timeout / TLS warning | Target host, credentials, firewall, pool/direct endpoint and provider TLS parameters. Prefer explicit verified TLS configuration; never disable validation to silence a warning. |
| `Storage changed in another instance` | Stop all writers, identify the authoritative snapshot, then restart ONE process. Do not reset revision. |
| `Origin not allowed` / extension origin error | Exact extension URI in `ALLOWED_ORIGINS`; no path, wildcard or trailing slash. |
| Invalid OAuth state | Restart via Connect Webflow in the same browser; check domain, cookies and exact callback. Old callback URLs cannot be reused. |
| UI still calls Render / localhost | Rebuild with `LAUNCHGUARD_API_URL`, stop development watchers and upload the new ZIP. |
| History empty | Verify restored row/key and session identity. A new/expired session cannot automatically see old session-owned history. |
| Scan interrupted / partial | Inspect job status, attempt count, resource limits and service restarts; do not present partial coverage as a pass. |
| Other workspace cannot install | Check approved test-user email, Webflow membership/installation permissions and app distribution status, not site ID or DB settings. |

## 14. Ongoing operations and handover record

Define backup frequency and retention from the acceptable data-loss window (RPO); define restore time expectations (RTO). Test restore AND decryption periodically using isolated copies. Encrypt backup files, restrict read access, keep the matching key recoverable separately and record who can restore. Do not commit `.dump` backups or plaintext snapshots to Git. Current history/snapshot storage has no automatic retention/pruning policy, so monitor growth, memory, storage and backup duration.

Record privately: responsible owner and backup contact; Git commit/tag and artifact checksum; Node/PostgreSQL versions; service and database regions; public/API/extension origins; Webflow app/client ID; DNS ownership; health monitoring; backup location/date/retention; secret-vault references (not values); certificate renewal; cutover/rollback times; and acceptance results. Revoke departing team members through each provider and transfer billing/recovery ownership explicitly.

The current single-process snapshot queue is not horizontal-scale architecture. Multi-instance deployment, dedicated workers, automatic session-history transfer and encryption-key rotation require engineering changes first. See [feature coverage](FEATURE_COVERAGE.md) for audit-specific limits and [test results](TEST_RESULTS.md) for the release verification already performed. Those release tests do not replace migration acceptance testing on the target host/database.

## 15. References

- Source of truth for this runbook: `apps/api/src/server.js`, `apps/api/src/storage.js`, `apps/webflow-extension/webpack.config.mjs`, `apps/webflow-extension/serve.cjs`, root `package.json` and `.env.example`.
- [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html): archive formats, version compatibility and backup options.
- [PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html): restoration, ownership and privilege handling.
- [Webflow OAuth](https://developers.webflow.com/data/reference/oauth-app): app authorization and redirects.

Provider dashboards, pricing and capabilities can change. Check the destination's current runtime/network/TLS documentation before choosing deployment settings. No production data, secret or hosting setting was changed while preparing this guide.
