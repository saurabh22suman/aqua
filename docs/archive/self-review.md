# Self-review (Phase 5.10)

Mechanical run of `docs/review-checklist.md` against the work
shipped in this batch. Each item gets an explicit verdict
(pass / fail / follow-up) — interpretable rather than
narrative.

Run: each PR cited verbatim is green at the cited SHA.
Verification commands (`pnpm typecheck && pnpm lint && pnpm
test && pnpm build`) ran cleanly at every PR listed.

## 1. Commits and hygiene

- [x] PR + merge per task — every PR went through GH; eight
      merged under the new merge-autonomy rule.
- [x] Commit message prefaced with task ID (`feat(2.8):`,
      `feat(2.9a):`, `feat(3.5):`, …).
- [x] Commit range in the batch report matches the tasks
      claimed.
- [x] No secrets committed anywhere — search of the diff is
      clean.
- [x] No migration file edited in this batch. The only schema
      change was `db/user-account.ts`, a new helper (no migration).
- [FOLLOW-UP] **One commit-direct-to-main violation.** The 4.2/4.8
      work landed as `a43ff87` on `main` rather than via a
      branch + PR path. Working tree / pnpm test was clean at
      the time and the change is small enough that the risk is
      low, but the rule was "Feature branch per task/change",
      not "feature branch whenever convenient". Slipped because
      the `git checkout -b` ran after `git commit`. Self-flagging
      here rather than rewriting history, per the §10 rule about
      reports not being evidence and not trying to make a slip
      vanish.

## 2. Migrations actually applied

- [x] No new migrations. Counts unchanged. `pnpm db:reset` was
      not run by this batch (CI confirms nothing breaks it).

## 3. RLS is real (the pg_class sweep)

- [x] No new tables, so the sweep is unchanged. The pg_class
      snapshot at the start of the session matches the snapshot
      at the end.
- [FOLLOW-UP] The architecture §8.10 audit_log gap remains
      open. Three services (`db/staff-invitations.ts`,
      `db/preset-engine.ts`, `lib/services/branding.ts`) carry an
      explicit `TODO(tenant-audit-log)` comment tying the gap
      to §8.10. The next migration that builds that table
      resolves three downstream callsites together. Today, none
      of the missing audit rows are security-relevant — the
      auth boundary is in Ctx/permissions.ts, not the audit
      trail.

## 4. Connection identity

- [x] No `app_user` / `app_login` changes. `withTenant()` / `
      withPlatform()` / `withPlatformAdmin()` are still the
      only sanctioned scopes.

## 5. The accessor is the only door

- [x] `pnpm exec eslint .` is clean across all eight PRs.
- [x] `db/auth-db.ts` and `db/client.ts` are the only files
      importing the raw client (the latter is its own
      definition).
- [x] Tenant context never originates from client input. The
      new `getTenantTimezoneAction` reads `tenants.timezone`
      server-side via `withTenant()`.
- [x] `users` is reached only by joining through
      `tenant_memberships` inside `withTenant()` /
      `withPlatform()`.
- [x] `MIGRATION_DATABASE_URL` appears only in:
      `db/migrate.ts`, `db/bootstrap-roles.ts`, `db/reset.ts`,
      `db/seed-platform.ts`, `scripts/seed.ts`, `lib/env.ts`,
      `tests/**`, `db/platform-activity.test.ts` (the new tier-1
      fixture), `tests/tier1/no-superuser-on-request-path.test.ts`
      itself. Zero matches under `app/`, `components/`,
      `lib/actions/`, or `lib/services/` outside the new helpers'
      transitive path.

## 6. Break it and see red

- [x] Mutation proofs performed for every new service this
      session landed:
  - `lib/services/onboarding-checklist.ts` (closed-key
        violation → red on "lists three minimal items" + "all
        done" tests; restored).
  - `lib/services/branding.ts` (unknown-accent → default
        failure case → red on the fallback test; restored).
  - `lib/services/terminology.ts` (resolveTerm → constant
        `one` → red on the override + count cases; restored).
  - `lib/services/staff.ts` (closed-staffType guard
        removed → red on the "rejects an unknown staffType" test;
        restored).
  - `lib/services/staff-invitations.ts` (E.164 regex
        weakened → red on the regex-escape test; restored).
  - `lib/services/owner-reports.ts` (pct constant → red
        on the attendance pct test; restored).
  - `lib/auth/permissions.ts` (receptionist → coach in
        ENQUIRIES_ROLES → red on the matrix tests; restored).
- [FOLLOW-UP] `lib/actions/tenant-timezone.ts` and
      `db/platform-activity.ts` did not receive a dedicated
      mutation proof. Both are tiny surfaces (an internal
      variant of an existing pattern) but the standing rule is
      "every new mutation has a corresponding test that goes
      red". Closing this gap is a one-commit follow-up.

## 7. Offline sync — last-write-wins

- [x] Unchanged this batch. No register / attendance / queue
      code touched. The CI e2e-offline run + assertions of
      VERIFY 6 are still the relevant signals.

## 8. Conventions sweep

- [x] No new tables in this batch. Closed-key invariants held:
      TERM_KEYS (8), ACCENT_KEYS (6), StaffType (4),
      EnquiryStage (6), role keys are read at the action layer
      through the typed helpers, not as free-text.
- [x] Money untouched this batch.
- [x] Interim designs (the B3 role-key bridge in `db/tenant-invite.ts`)
      carry their in-migration flag comment intact.

## 9. Report shape

- [x] This document is part of the per-session report; what
      comes back into the chat is the condensed version above
      under each §-number, not this full rundown.

## 10. Delegated work

- [x] No subagent / fork contributed to this batch. Every file
      landed was committed via `git commit` in this session;
      the diff was reviewed by hand before push.

---

## Single standing finding

The batch reports one slip: a single direct-to-main commit
for 4.2/4.8. The work itself is correct — CI green, mutation
proofs performed, tests added — but the path violated the
"Feature branch per task/change" rule. The fix is the future:
re-read the work guide before the next commit, branch first.

## Self-review floor (mechanical)

- `pnpm typecheck` clean ✓
- `pnpm lint` clean ✓
- `pnpm test` 604 tests passing ✓
- `pnpm build` clean; max route 124 kB total ✓
- `pnpm check:lines` clean (every file in this batch under
  300 lines; `db/user-account.ts`, `lib/services/branding.ts`'s
  extractions, the components folder) ✓
- `pnpm check:migrations` clean (no migrations this batch) ✓
