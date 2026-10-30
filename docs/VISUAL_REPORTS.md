# Visual issue reports and screenshots

This update adds a Visual report mode and downloadable self-contained HTML reports. It extends existing audit rules; it is not a new general-purpose visual QA, spelling, security or AI assessment engine.

## Use the report

1. Select the published-content rules you want to run (for example Image alternative text or Internal links).
2. Leave **Visual evidence (desktop and mobile screenshots)** selected (enabled by default for new audits), then run the audit. Screenshots alone do not detect defects, so the API requires another published-content check too.
3. In Results, select the **Visual report** icon next to Compact findings. Search/filters still apply. Visual report cards show each matching finding individually, without resource grouping, 20 per page; the summary counts the full scan, not just the current filters/page.
4. Each card includes category/severity/status, actual and expected behavior, why it matters, fix instructions, technical details, and available desktop/mobile close-up and context images. Use Enlarge screenshots to inspect them.
5. Use **Download visual HTML report** for a complete report (all findings, not just the filtered page). Open the HTML in a browser; its print dialog can save it as PDF. There is no built-in server PDF generator in this update.

## What screenshots establish

Capture uses isolated, unauthenticated Chromium at desktop 1440x900 and mobile 390x844 (touch emulation). The audited element is outlined red after detection. Images are a visual locator, not independent proof that an alt attribute is missing or a link target failed. Metadata has no visible element to outline. The app does not invent exact replacement alt text, assess filename-style alt quality, or infer missing images of an unsaved CMS item.

Supported locations: image-alt/loading findings identified by the exact rendered image URL; internal/download links identified by the exact destination; H1 findings when a unique visible H1 exists. A missing H1, multiple matching elements, responsive source changes or hidden elements can prevent mapping. Such findings retain their real textual evidence and an explicit unavailable reason rather than a fabricated annotation. Context images are the scrolled page viewport, not an unlimited full-page screenshot. Only captured viewports are listed; a desktop capture is not evidence that the same defect was confirmed on mobile.

## Backend setup

Deploy the updated API and uploaded extension bundle. Set `ENABLE_RENDERED_CHECKS=true` only on a backend with the matching Playwright Chromium binary and its operating-system dependencies installed. The existing Playwright package is reused; on a compatible build image, `npx playwright install --with-deps chromium` installs the browser/dependencies. Ensure they remain available at runtime. Managed native hosts may restrict dependency installation; use a suitable container/runtime rather than disabling browser isolation. This guide does not provision Chromium on the current Render service.

Without Chromium/that flag, visual capture reports unavailable. The report layout and HTML download still work for text-only/older audits. Existing scans do not gain screenshots automatically; re-run them after enabling the option.

The deployment update adds an npm postbuild step: when `ENABLE_RENDERED_CHECKS=true`, `npm run build` installs the matching Chromium binary. On Render, an unset browser path defaults to `PLAYWRIGHT_BROWSERS_PATH=0` at build and runtime so the binary is included under node_modules rather than a discarded home cache. Set the flag in Render, then choose Save, rebuild, and deploy; a restart alone will not run the installer. The installer does not install privileged OS packages. If system libraries are missing, use a compatible runtime/container. `/health` version 0.4.1 exposes `features.visualEvidence` and `browser.enabled/installed`; installed means the binary exists, not that every Linux library or customer page has been verified.

## Limits and storage

- At most two published pages and twelve distinct visual targets per audit are selected for screenshots, with up to two viewport captures per target. Duplicate findings for the same exact target reuse the capture result. Browser time and image-byte limits still apply, so selection does not guarantee capture.
- Each viewport opens a clean browser, uses the existing isolated public-address-validated GET/HEAD request path, blocks service workers/WebSockets/WebRTC/POSTs/popups, caps at 40 browser requests and closes after the existing 18-second watchdog. Existing published-scan request/time policies still apply.
- JPEG quality 55; each close-up/context pair is capped at 400 KB; total image bytes cap at 1 MB per captured page (2 MB per scan), before base64 overhead. Form inputs, textareas and editable regions are masked in screenshot output. No page interactions, submissions or authentication are performed.
- Captures are embedded in findings inside the existing encrypted PostgreSQL snapshot, not a public image directory. No schema migration or key change is required. Snapshot/history retention is still manual; monitor memory, database growth and backups. Large-scale image history needs a separately designed private object store/retention policy rather than raising these limits blindly.
- Unavailable expected captures make screenshot coverage partial. Findings with no applicable visual location remain textual. No available screenshot is not a clean bill of health.

## Sharing and privacy

Only the owning audit session can retrieve screenshot data through the private scan endpoint. Existing access-controlled shared report links omit the images and display an owner-only reason, including for other users who can access the same site. Owner JSON/HTML exports include screenshots and are sensitive files; the exported HTML has no authentication, expiry or revocation. Share it only with trusted recipients. Downloaded files cannot be revoked by the report-link revocation action.

## Validation

Link screenshot matching uses both the exact destination and the detected link label, so differently labeled buttons pointing to the same fragment are not confused. If both destination and label still match several elements, capture remains unavailable rather than selecting one arbitrarily. Run a new scan to obtain structured link labels; old saved findings are not modified.

Backend tests exercise supported/unsupported mapping, partial capture and private/shared evidence access. Browser tests capture actual fixture images on both viewports, check that red annotation pixels exist, reject ambiguous link matches, verify HTML escaping and disabled-browser fallback, and test report layout/download at 800 and 320 pixels. Fixtures are clearly labeled; they are not live customer audits. Live screenshots on the deployed runtime and uploaded Webflow app still require verification after deployment.
