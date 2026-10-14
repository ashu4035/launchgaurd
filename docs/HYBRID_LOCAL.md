# LaunchGuard hybrid development

The standalone dashboard and Designer Extension share `packages/ui/AuditApp.tsx` and the Node API. Both can select CMS required-field checks, check Webflow page SEO settings, run scans, poll status, cancel scans and reopen history. The extension restricts the interface to the current Designer site; the backend separately verifies site access.

## Local setup

Create `.env` at the repository root using `.env.example`. Set `WEBFLOW_SITE_API_TOKEN` to a site token with sites, CMS and pages read access. Never add it to client code or Git. Start `npm run api` and `npm run dev`. Token mode is disabled when `NODE_ENV=production` and is intended only for a local single-user environment.

Build the extension with `npm run build-webpack --workspace=LaunchGuard`. Serve the existing extension scaffold with the Webflow CLI from `apps/webflow-extension` on port 1337 and load it in Designer. Its development API address is `http://localhost:8787`. No site content is changed.

## Verification and remaining work

Both production frontend builds and rule tests pass. A mocked Webflow integration test covers site authorization, collection fields, scan results and shared history. Live Webflow data and execution inside Designer require account credentials and have not been verified.

The extension's deployed authentication needs authenticated Designer identity, an HTTPS backend and an appropriate cross-origin session flow; the local cookie/token setup is not the distributed app design. OAuth routes already exist but require browser-bound state hardening and live validation. Stored tokens are currently local JSON, and the scan queue is in-process. Published HTML, broken links, image checks, durable storage and Marketplace submission remain future milestones.
