# ADR 0002 — TypeScript monorepo

- Status: accepted.
- The project uses a pnpm workspace with packages under `packages/` and apps under `apps/`.
- TypeScript is the common implementation language.
- `tsconfig.base.json` defines the shared strict compiler baseline.
- `@devverify/core` is the shared library boundary.
- The CLI, crawler, Action, and site can evolve independently while sharing core logic.
- Workspace package boundaries reduce duplication between delivery surfaces.
- pnpm provides one lockfile for deterministic dependency installation.
- Build outputs remain package-specific.
- Each task is kept focused so changes can be reviewed and verified independently.
- The repository uses ESM consistently.
- This structure matches the project plan without introducing a server runtime.
