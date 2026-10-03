# ADR 0005 — Astro for the site

- Status: accepted.
- Astro is the planned framework for `apps/site`.
- The site is primarily static content and build-time data.
- Astro supports generating HTML and endpoint files during the build.
- JavaScript is opt-in rather than the default delivery mechanism.
- Preact islands are reserved for interactive search/table behavior and the APK tool.
- This matches the static-first architecture and zero-JS content-page goal.
- The site consumes the dataset at build time rather than querying a backend.
- GitHub Pages can host the generated output.
- Site-specific constraints are documented in `apps/site/AGENTS.md`.
- Localization and deployment are later tasks in the build plan.
- Replacing Astro would require a new decision record.
