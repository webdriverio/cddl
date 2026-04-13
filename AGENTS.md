# Cursor Cloud specific instructions

- This repository defines a repo-level cloud agent environment in `.cursor/environment.json`.
- The corresponding `.cursor/Dockerfile` pins Node 24 and pnpm 10.32.1, then preinstalls the pnpm workspace dependencies into `/workspace`.
- You can run these commands immediately in a fresh cloud agent without a preliminary `pnpm install`:
  - `pnpm compile`
  - `pnpm run test:typechecks`
- For focused Vitest runs, disable coverage so single-file or narrow test selections are not blocked by the repo's global coverage thresholds:
  - `pnpm exec vitest --config vitest.config.ts --run --coverage.enabled=false packages/cddl/tests/parser.test.ts`
