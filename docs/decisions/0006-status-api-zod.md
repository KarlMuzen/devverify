# ADR 0006 — Validate Status API responses with zod

- The Status API response is an untrusted external JSON boundary.
- Runtime validation is required before exposing response fields to callers.
- `@devverify/core` uses zod only at that boundary.
- The dependency is kept in the core package, not the workspace root.
- Response schemas validate required fields and allow unknown fields.
- Unknown API state values are preserved as `rawState` and mapped to `UNKNOWN`.
- Malformed JSON or required-field mismatches become `ProtocolError`.
- No API key is included in parsed error payloads or thrown error causes.
- zod is MIT-licensed and has no runtime dependencies.
- The lockfile records an exact resolved zod version for reproducible installs.
