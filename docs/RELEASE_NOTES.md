# Bulk audit release

Webflow submission notes (under 500 characters):

Bulk audits for saved CMS fields/assets and published SEO, links, downloads, images, alt text, headings and indexing policy. Adds scope selection, progress, filters, issue details, rechecks, history, exports and expiring access-controlled reports. Read-only: no editing or publishing. Includes bounded network checks and scan recovery. Browser-rendered checks require optional server Chromium. Single-worker release.

Upload apps/webflow-extension/bundle.zip after the backend deployment is live. Keep existing Render OAuth, DATABASE_URL, TOKEN_ENCRYPTION_KEY and ALLOWED_ORIGINS values. Build command remains npm ci --include=dev && npm run build; start remains npm start. No new OAuth scope is required by this release.

Verify one small staging audit in Designer before running a broader scope. Live scans require a custom domain returned by Webflow. Exact coverage and limitations are in FEATURE_COVERAGE.md.
