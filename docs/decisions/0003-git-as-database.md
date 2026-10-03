# ADR 0003 — Git as the database

- Status: accepted.
- The published dataset is stored as sorted NDJSON on a dedicated `data` branch.
- Git history provides a durable, reviewable record of dataset changes.
- The main code branch remains focused on source, tooling, and site code.
- Deterministic ordering is required so equivalent crawls produce stable diffs.
- A static site build reads a known repository snapshot.
- No database service is required for the published dataset.
- The crawler owns the write path to the data branch.
- The site consumes the data branch at build time.
- This keeps the architecture zero-cost and compatible with GitHub Pages.
- Operational procedures for the data branch remain documented and bounded.
- A future change to storage should be recorded as a new ADR.
