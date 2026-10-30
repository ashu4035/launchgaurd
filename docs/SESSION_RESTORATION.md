# Restoring a Designer connection

This update adds server-verified Designer session restoration. It is not enabled on production merely by editing these files.

## Enable in this order

1. In the existing LaunchGuard Webflow app, enable **Authorized User: Read** (`authorized_user:read`) alongside the current sites/CMS/pages read permissions. Follow any Webflow review requirement for the app's distribution status before requesting changed scopes.
2. Deploy the updated API code, then set `WEBFLOW_IDENTITY_ENABLED=true` on the host. Keep the database, encryption key, client identity and existing origins unchanged. If the flag is false/absent, existing OAuth scopes remain unchanged and restoration is disabled.
3. Upload the newly built `apps/webflow-extension/bundle.zip` using Publish extension version. Both the backend and bundle must be updated.
4. Open the uploaded app and connect once with the updated permissions. The server binds this LaunchGuard session to the Webflow-verified Designer user/site. Old unbound sessions are not guessed or matched using email/site alone.
5. Close/reopen the extension and refresh Designer. It should restore the same unexpired session/history without repeating OAuth. Test Disconnect and an account/site switch too.

## Security and limits

- The extension obtains a fresh `webflow.getIdToken()` proof in memory on each launch. The backend resolves it through Webflow's fixed `/beta/token/resolve` endpoint using a server-only OAuth token, then checks the resolved user and site and current site authorization. It does not trust a decoded JWT or client-supplied site ID as authorization.
- A session can restore only the identity/site previously bound using possession of that session. Up to five recent bound candidates for the site are considered; it fails closed if none matches. No broad cross-user/site fallback is allowed.
- The returned opaque LaunchGuard session stays in memory. Neither it nor Webflow access/ID tokens are written to localStorage/sessionStorage by the new UI. A legacy temporary session entry is removed at startup. Webflow access tokens and identity bindings remain in the existing encrypted PostgreSQL snapshot.
- The original seven-day session expiry is NOT extended by opening the app. Expired sessions require reconnection in this release. Disconnect deletes the server session, so later launches cannot restore it. This is not permanent OAuth installation identity or an account/history migration system.
- The standalone dashboard keeps its existing HttpOnly cookie flow. No third-party cookie support is required for Designer restoration. An older backend/bundle or unavailable identity API falls back to manual connection. Browser clearing alone no longer requires reconnecting while a verified bound session remains valid.
- Webflow's ID-token resolution endpoint is currently documented as beta. Live verification inside the uploaded app is still required after permission/configuration changes; mocked tests cannot confirm the app's actual Webflow permissions.

References: [Designer ID token](https://developers.webflow.com/designer/reference/get-user-id-token), [Resolve ID Token](https://developers.webflow.com/data/v2.0.0-beta/reference/token/resolve), [official Hybrid App example](https://github.com/Webflow-Examples/Hybrid-App-Authentication).
