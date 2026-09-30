# Published artifacts required by Casa Club

Active checkout: /Volumes/Dock/GitHub/workspace/packages/maplibre-gl-js.

The manifest declares lib/index.js and lib/index.d.ts, while the existing publish job runs build-dist. Published 6.9.9 and 6.9.10 archives therefore omit the declared entry points. Existing maps consumers also import dist/maplibre-gl.css, but the manifest did not include dist.

The package prepack lifecycle now runs the existing complete lib build. The files allowlist includes both lib and dist, retaining the legacy CSS path. No CI workflow or version change is required; publication remains the existing CI job's responsibility. No generated output is copied into a consumer.

Verification: local full lib build passed on 2026-09-30. Package archive verification is recorded below. This source fix is not a published release; Casa Club must consume a newly published version before deployment.

Archive dry-run after local builds verified lib/index.js, lib/index.d.ts, lib/maplibre-gl.css and legacy dist/maplibre-gl.css. This does not prove registry publication.
