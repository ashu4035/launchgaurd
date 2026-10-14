# LaunchGuard Webflow setup (manual steps)
1. Create a free Webflow Developer Workspace, or use your existing eligible workspace.
2. In Workspace Settings → Apps & Integrations → Develop, register a new App called LaunchGuard.
3. Enable Designer Extension and Data Client to prepare a Hybrid App.
4. Configure an **HTTPS** OAuth redirect URI belonging to your backend. It does not exist yet; registration of the Data Client is therefore blocked pending backend implementation and a reachable HTTPS address.
5. Choose **read-only** scopes required by the final endpoints you invoke. Verify exact values in the official scopes reference. Do not enable write scopes for the audit MVP.
6. Install only on an authorized test site. Avoid production site changes.
7. For official extension integration, use `webflow extension init launchguard-extension react`, or adapt this React interface into the generated scaffold; launch it with the CLI's `webflow extension serve` and Webflow Designer's **E → Launch development app**. The current Vite prototype is **not yet an installed Designer Extension**.
8. Never share client secrets here. Keep OAuth credentials server-side in `.env`, not Git.

Official documentation:
- https://developers.webflow.com/designer/reference/designer-api/getting-started
- https://developers.webflow.com/apps/data/docs/register-an-app
- https://developers.webflow.com/data/reference/oauth-app
- https://developers.webflow.com/data/reference/scopes
- https://developers.webflow.com/cli/command-reference

# Package registry required to produce/verify the lockfile; CI uses npm ci after lockfile is generated.
