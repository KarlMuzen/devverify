# ADR 0004 — No backend

- Status: accepted.
- devverify does not deploy an application server.
- Site requests are answered by static assets and generated endpoint files.
- Daily data refresh belongs in the scheduled crawler.
- The planned Status API quota is 1,000 requests/day.
- That quota is incompatible with unbounded live lookups from site visitors.
- Static snapshots also avoid exposing the API key to browser clients.
- The browser APK tool performs local parsing and only reads the published snapshot for its optional check.
- GitHub Actions provides the scheduled execution environment.
- GitHub Pages provides static hosting.
- This architecture minimizes runtime dependencies and operational cost.
- Any future backend proposal must be justified in a new ADR.
