# AGENTS.md

Entry point for coding agents in this repo. See [.agents/README.md](.agents/README.md)
for available skills — read a skill's `SKILL.md` when its description matches
the task, don't duplicate its rules here.

No tool-specific agent config is committed beside `.agents/` — permissions,
hooks, and other per-tool settings (e.g. `.claude/`) stay personal and local,
never added to this repo. A thin adapter file like `CLAUDE.md` is the one
exception: it only points here, it doesn't hold its own copy of these rules.

## Repo map

pnpm workspace, no lerna/nx. `cddl` is the CDDL parser every other package
depends on (via `workspace:*`); the five `cddl2*` packages are independent
generators built on top of it:

```
packages/cddl          CDDL → AST parser, shared by every generator below → npm: cddl
packages/cddl2ts       AST → TypeScript generator                         → npm: cddl2ts
packages/cddl2java     AST → Java generator                               → npm: cddl2java
packages/cddl2py       AST → Python generator                             → npm: cddl2py
packages/cddl2swift    AST → Swift generator                              → npm: cddl2swift
packages/cddl2kotlin   AST → Kotlin generator                             → npm: cddl2kotlin
examples/              real-world CDDL specs (webdriver-bidi) used across every package's tests
```

Each package has its own `.release-it.ts` (sharing common config from
`.release-it.base.ts`) and version — there is no monorepo-wide version to
keep in sync.

## Docs

`packages/cddl/docs/*.md` hand-documents the AST (`ast.ts`/`parser.ts`) with
worked examples — it is not generated, so nothing keeps it in sync
automatically. Any AST change (a new operator, a new field, a changed shape)
needs a matching doc update in the same PR: check `packages/cddl/docs/` for
the relevant file(s), not just the type declarations, but every worked
example and enumerated list. This isn't hypothetical — `references.md`/
`ranges.md` (missing `IsFloat`) and `operators.md` (missing two whole
operators, `OperatorType` union, numbered list, and worked examples) were
each found stale only by manual review, not by anything automated catching it.

## Setup

Node 24, pnpm pinned in `package.json#packageManager`.

```sh
pnpm install
pnpm run compile   # compiles cddl first, then every other package (they depend on its build output)
```

### Cursor Cloud

This repository defines a repo-level cloud agent environment in
`.cursor/environment.json`. The corresponding `.cursor/Dockerfile` pins Node 24
and pnpm 12.5.1, then preinstalls the pnpm workspace dependencies into
`/workspace`. You can run these commands immediately in a fresh cloud agent
without a preliminary `pnpm install`:
- `pnpm compile`
- `pnpm run test:typechecks`

## Test selection

Don't default to `pnpm run checks:all` — it's compile + typechecks + unit
tests + cli-examples across every package. Prefer the smallest proof:

| Change | Run |
|---|---|
| One package's `src/` (not `cddl`) | `pnpm exec vitest --config vitest.config.ts --run --coverage.enabled=false packages/<pkg>/tests/<file>.test.ts` — coverage is disabled here since a single-file selection otherwise gets blocked by the repo's global coverage thresholds |
| `packages/cddl/src` (the shared parser) | every `cddl2*` package depends on its output, so run the full suite: `pnpm run test:unit` |
| Root config, or more than one package | `pnpm run checks:all` |

There is no lint step configured in this repo.

## Releases

Manual, via the "NPM Publish" GitHub Action
([.github/workflows/publish.yml](.github/workflows/publish.yml)) — never
automatic on merge. `cddl` always releases first, in its own job, since every
`cddl2*` package depends on it via `workspace:*`; the rest release afterward
as a sequential matrix (and are skipped entirely if `cddl`'s release job
fails). Selecting `package: all` auto-detects and releases only packages
changed since their last release tag (a shared-`tsconfig.json`-only change
still counts, since `.release-it.base.ts` scopes every package's changelog to
include it); picking one package explicitly always releases it regardless of
whether it changed.

`main` requires PRs, so the release jobs push the version commit and tag
with a GitHub App token (`RELEASE_APP_CLIENT_ID` variable and
`RELEASE_APP_PRIVATE_KEY` secret in the `release` environment). The app is
a bypass actor on the "Main" ruleset; nothing else may push to `main`.

## Working agreement

Commit messages, PR descriptions, code comments, and how to stage changes:
see the [concise-writing](.agents/skills/concise-writing/SKILL.md) skill —
same "why, not what" rule across all of it.
