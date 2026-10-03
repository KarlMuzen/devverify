# apps/site rules
- Static output only. No server endpoints, no runtime requests to third parties, no analytics, no web fonts, no cookies.
- Dataset is validated at build time with zod. Invalid data fails the build.
- Zero JS by default. Preact islands only for search/table and the APK tool, hydrated lazily.
- Accessibility: semantic HTML, WCAG 2.2 AA contrast, visible focus, status shown as text + icon + color, keyboard operable, prefers-reduced-motion respected. Every chart has a table fallback.
- /tools/apk-fingerprint/ has a CSP meta tag with `connect-src 'self'`. The APK never leaves the device.
- Page weight: app detail HTML <= 60 KB gzip; zero JS on content pages.
- Wording rules from the root AGENTS.md apply to every string.
