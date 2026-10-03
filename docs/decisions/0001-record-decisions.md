# ADR 0001 — Record project decisions

- Status: accepted.
- devverify records architecture decisions as short ADRs.
- ADRs preserve the reason for non-obvious technical choices.
- The build plan remains the source of task order.
- Root `AGENTS.md` remains the source of implementation constraints.
- Decisions should state the problem, chosen approach, and consequences.
- Later tasks may add an ADR when a new runtime dependency is introduced.
- ADRs are documentation, not a substitute for tests or live verification.
- Human-only verification remains tracked in `docs/LIVE_VERIFICATION.md`.
- This file establishes the ADR numbering convention.
- Numbered files make future decisions easy to reference from code and docs.
- Reversing a decision should create a new ADR rather than silently rewriting history.
