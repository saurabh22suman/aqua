# Pilot remediation register

**Audited commit:** `c198627fa0e41f6268b75d3a8c2dd2f18d6a3d51` (merged PR #191). Source: `docs/audits/2026-09-23-post-pr191-comprehensive-audit.md` (SHA-256 before and after branch switch: `f88d8d64c08f9fe9195d5be85f64f39699fb2e3250bb5fbe24158d2e0fd01e8e`).

**Workflow:** protected `main`, short-lived `fix/pilot-safety` for PR-A, human merge only. PR-B starts only after PR-A is merged by the human. A checkbox is complete only after acceptance and tests pass; evidence includes the exact command/results, migration if any, commit SHA and deviations. This register does not grant release approval.

| Field | Current value |
|---|---|
| Current status | Audit preserved (`5251dd3`); A1 dependency patch verified locally, awaiting commit. |
| Current task | F03 legacy-consent attestation and F08 bounded CSV validation. |
| Next task | F04 concurrent, atomic import. |
| Known blockers | Full suite timed out twice in the audit; offsite backup/restore and Production deployment remain PR-B/human gates. No pilot release approval. |

## PR-A — Pilot Safety

- [x] **A0: Preserve the source-first audit and this task register.** Acceptance: report checksum unchanged and both files committed on `fix/pilot-safety`; no existing work overwritten. Evidence: `git status --short` showed only the audit before switching; `git ls-tree -r --name-only origin/main -- docs/audits/2026-09-23-post-pr191-comprehensive-audit.md docs/pilot-remediation-checklist.md` returned neither path; `sha256sum docs/audits/2026-09-23-post-pr191-comprehensive-audit.md` = `f88d8d64c08f9fe9195d5be85f64f39699fb2e3250bb5fbe24158d2e0fd01e8e` before and after switch and after commit `5251dd3`. Migration: none. Deviation: none.
- [x] **A1 / F01: Patched Next.** Acceptance: smallest compatible patched Next resolving GHSA-2xp9-vwfh-vxw4, lockfile updated normally; `_next/image` reachability assessed; remaining `pnpm audit --prod` advisories classified individually. Evidence: `pnpm up next@15.5.24 eslint-config-next@15.5.24`, then exact pins and `pnpm install --lockfile-only --offline && pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint` PASS; `pnpm build` PASS (Next 15.5.24); `pnpm check:bundle` PASS (92 routes, max 130/150 kB); `pnpm check:fonts` PASS on retry (55.2/60 kB; initial 240s tool timeout after static-page generation). A production `next start -p 3227` probe of `/_next/image?url=%2Fsw.js&w=64&q=75` with `Host: ops.localhost:3227` returned image optimizer HTTP 400 `The requested resource isn't a valid image`, confirming endpoint reachability even on ops host, not AVIF exploitability. `pnpm audit --prod`: 5 remaining (2 high, 3 moderate): GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849, GHSA-qx2v-qp2m-jg93, GHSA-fxqj-rqcc-2cmp are on Next's pinned PostCSS 8.4.31, not the direct 8.5.26; no route accepting user-supplied CSS/source maps was identified, so build-tool reachability requires monitoring. GHSA-67mh-4wv8-2f99 is esbuild via optional better-auth/drizzle-kit dev tooling, not a shipped server feature. Next AVIF/Windows and sharp findings disappeared. No advisories suppressed. Migration: none. Commit SHA: pending. Deviation: pnpm's normal lock resolution also refreshed compatible transitives; no unrelated direct major update.
- [ ] **A2 / F03: Legacy consent attestation.** Acceptance: explicit operator attestation required at commit, prior off-platform evidence represented in existing consent/audit model with actor, tenant, UTC time, import identity, channel and optional evidence note; guardian for minors; preview stores nothing; retry cannot duplicate consent; normal onboarding unchanged. Tests: missing attestation, adult/minor/guardian, actor+tenant+timestamp, cross-tenant, preview and retry. Evidence: pending. Migration: none expected.
- [ ] **A3 / F08: Bound and validate import input.** Acceptance: existing byte ceiling plus maximum 500 data rows, explicit malformed quotes/encoding/date errors, downloadable CSV spreadsheet-safe for any user-controlled fields. Tests: 500/501 boundary, malformed quote, UTF-8 detection, embedded newline/comma, invalid dates, error export. Evidence: pending. Migration: none.
- [ ] **A4 / F04: Serial, retry-safe commit.** Acceptance: stable tenant+normalized-content identity; at most one tenant import in flight; identical and distinct concurrent uploads safe; atomic whole-file commit or durable per-row results; no overwrites and audit in the same transaction. Tests: simultaneous identical/distinct files, cross-tenant, interrupted retry, code collisions, accurately audited results. Evidence: pending. Migration: none expected if atomic path viable; if a new table becomes necessary, stop and ask under `AGENTS.md`.
- [ ] **A5: Deterministic complete test gate.** Acceptance: profile dominant suites, shard all test files exactly once, isolate migration-heavy/concurrency tests, aggregate fail/pass, fix practical IST-midnight instability without dropping tests; document local and CI commands. Tests: run the entire sharded gate and show aggregate result, not just targeted tests. Evidence: pending. Migration: none.
- [ ] **A6: PR-A final gate.** Acceptance: frozen install, typecheck, lint, complete sharded suite, build, audit, migration and tenant/RLS/permission checks, host boundary, parent zero-JS, import/consent/concurrency tests, bundle/fonts/focus, compose scanners; record exact results and deviations, push and open PR to `main`; stop without merge. Evidence: pending.

## PR-B — Operational Readiness (not started)

- [ ] **B1 / F02:** Offsite R2 backup and restore proof, enabled worker jobs' configuration and backup schedule. Evidence: pending; out of PR-A.
- [ ] **B2 / F05–F06:** Dokploy/Production deployment and runbook parity, immutable image verification and human/VPS checks. Evidence: pending; out of PR-A.
- [ ] **B3:** Human pilot/Production operational release checks and role-specific runtime walkthrough. Evidence: pending; out of PR-A.

## Session log

| Date | Branch | Work / evidence | Status |
|---|---|---|---|
| 2026-09-24 | `fix/pilot-safety` | `git status --short` showed only the untracked audit report; `git fetch --prune origin` left `origin/main` at `c198627`; SHA-256 `f88d8d64…01e8e` before and after `git switch -c fix/pilot-safety origin/main`. | Baseline preserved; initial documentation commit pending. |
| 2026-09-24 | `fix/pilot-safety` | First commit `5251dd3` contains only audit and checklist; report SHA-256 `f88d8d64…01e8e` unchanged after commit. | A0 verified. |
| 2026-09-24 | `fix/pilot-safety` | Next/ESLint config 15.5.24; frozen install, typecheck, lint, build, bundle and font scanner passed; image endpoint returned HTTP 400 from optimizer on ops host; audit reduced from nine to five advisories. | A1 verified; commit pending. |
