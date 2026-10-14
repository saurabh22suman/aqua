# Remediation ledger — owner UI workflow / data-scope / state correctness (2026-10-14)

Input: `docs/audits/2026-10-13-owner-ui-review-and-image-prompts.md` §7,
`docs/audits/2026-10-13-role-workflow-audit.md`, and the Prompt 1 ledger
(`docs/remediation-ledger-2026-10-13-role-workflow.md`).

Baseline: branch `fix/comprehensive-review-findings` @ `870cf1a` plus the
Prompt 1 working tree (244 modified + untracked files). No branch switch,
no reset, no Prompt 1 work discarded, no tier1 test edits. Every review
source reference was re-read against the current implementation before
fixing; all P1 references still pointed at the described code.

Status legend: **reproduced** (observed failing behaviour) ·
**source-confirmed** (defect proven by reading current code) ·
**already fixed** (Prompt 1 closed it) · **not reproduced** ·
**fixed-and-verified** · **blocked** (human-owned or product decision).

## P1 — displayed data and mutation scope

| ID | Finding | Current evidence | Fix | Verification | Status | Remaining limitation |
|---|---|---|---|---|---|---|
| O-1 | Fees dues/invoices client reload dropped the facility scope (`components/fees/fees-invoice-list.tsx:39`) | `load()` called `listHubInvoicesAction({ status })` with no `locationId`; the server page rendered `initial` scoped by `facility` | `facility` prop threaded from `app/(owner)/owner/fees/page.tsx`; reload sends it; rows are scope-tagged and only rendered when the tag matches the current scope; a request-sequence guard discards superseded responses; failed reads show a retry instead of stale rows | `tests/mobile/owner-fees-scope.test.tsx` (scope carried, late response discarded, failure recovery); browser: with Worli + Andheri invoices, recording a ₹1,360 payment on the Worli dues row reloaded the list and the Andheri invoice did **not** appear (pre-fix it would have) | fixed-and-verified | Server predicate already intersected the explicit location with the caller's access; no server change needed |
| O-2 | Inline member edit submitted the original full-record snapshot, overwriting an earlier field save (`components/member-detail/inline-edit-field.tsx:151`; `lib/services/people.ts:391`) | `commit()` sent `snapshot.fullName`/`snapshot.phone`/… for every field; `updateMember` wrote every column | `updateMemberSchema` is now a strict field-scoped patch (`null` clears); `updateMember` writes only provided keys; the editor sends only the edited field, serialises same-field commits, reflects the server-echoed persisted value, and keeps a failed draft for retry | `tests/mobile/inline-edit-patch.test.tsx` (payload exactly `{memberId, fullName}`, stale snapshot absent, null clear echoed, draft retained); `tests/review-owner-ui-remediation.test.ts` (unrelated fields survive, null clears, out-of-scope refused, unknown key rejected); browser: name edit then phone edit then full reload kept **both** changes | fixed-and-verified | `InlineEditSnapshot` prop retained (optional) for existing callers/tier1 mocks; no optimistic-concurrency token, because field-scoped writes remove the cross-field conflict |
| O-3 | CSV import preview and commit could refer to different files (`components/member-import-form.tsx:37–45,109`) | `check()` had no request identity; commit sent `csvText` which could belong to a newer file than the preview | One `ActivePreview` object binds `{id, fileName, csv, preview}`; a monotonic id discards superseded validations; choosing a file immediately drops the old preview; commit sends the active preview's own text and reports the committed filename; a ref guards duplicate clicks | `tests/mobile/member-import-identity.test.tsx`: file A→B with out-of-order responses keeps B's preview and commits B's exact text; a second click during commit is ignored | fixed-and-verified | Server already revalidates and skips existing rows, so a duplicated request cannot double-import |
| O-4 | Reconciliation evidence/actions not bound to date+facility (`components/reports/collections-report.tsx:65,194–204`) | `load()` had no request identity; old report stayed rendered under a new date/location; count draft survived scope changes; actions used the new scope with old evidence | Report state is scope-tagged; a sequence guard discards stale responses; a scope change clears report + count/note drafts; confirmation is unavailable until current-scope evidence loads; actions bind to the displayed scope; the outcome names date + facility; failed reads show a retry | `tests/mobile/collections-report-scope.test.tsx` (draft cleared on facility switch, late date response discarded, message names the scope); browser: typed ₹1,200 for Andheri, switched to Worli → draft empty, evidence reloaded, button read “Confirm count for 14 Oct 2026 · Worli Main”, confirm reported “Counted for 14 Oct 2026 · Worli Main — variance ₹60.00 short” and refreshed the closed state | fixed-and-verified | Variance/closed/reopen rules, thresholds and timezone handling unchanged |
| O-5 | Roster publication scope derived from the add-shift form location (`components/staff-roster-board.tsx:96–99`) | Publish used the `locationId` state that the add-shift form (and template application) mutate | Separate `publishLocationId` state initialised from the board's week/location filter and synced when it changes; a visible “Publish the week of … / Scope: …” panel with its own selector; the add-shift date resets when the week changes; results name the week + scope + count | `tests/mobile/roster-publish-scope.test.tsx` (add-shift location cannot change the publish target, explicit scope honoured, week change resets the date); browser: changed add-shift location to Worli Main and the publication scope stayed “all locations” | fixed-and-verified | Server `publishRosterWeek` already intersects the target with the caller's location predicate |
| O-6 | Revoking active access had no confirmation (`components/invitations-board.tsx:81–91,183–192`) | Revoke fired immediately from an ordinary row button | Revoke opens a confirmation naming the phone, role and scope, and stating the consequence (links stop working, sessions stop working, directory record kept, restorable); Cancel performs nothing; repeated clicks are guarded; a failure keeps the panel open with the error; success uses `router.refresh()` and drops the stale link panel | `tests/mobile/invitations-revoke-confirm.test.tsx`; browser: confirmation rendered “Revoke access for +91 90000 00002? … coach … all locations …”, Keep access left the row Active, confirming revoked the row to “Revoked” with Reactivate intact (Prompt 1 behaviour preserved) | fixed-and-verified | Name display still requires a data projection (review item for the redesign); phone/role/scope is the available identity today |
| O-7 | Structured configuration stringified to `[object Object]` (`components/owner-config-form.tsx:39–49,146–153`) | `toInputValue` did `String(value)` on the `operations.business_hours` object | Structured values render a human summary (per-day hours or an honest “not configured”); business hours link to the Locations hours editor instead of a fake text field; known keys get human titles; provenance labels are human (“platform default”, “set for this academy”) with no UUID; scalar saves validate emptiness/number locally; thrown failures are reported | `tests/mobile/owner-config-structured.test.tsx` (no `[object Object]`, “Mon 06:00–21:00 · Sun closed”, link href, no Save for the structured value, no UUID); browser: configuration page rendered titles, human scope labels, “Not configured yet.” and the Locations link; no `[object Object]` at 1280 or 390 | fixed-and-verified | Business hours remain location-scoped by design; the page explains that rather than pretending to edit them |
| O-8 | Holidays board froze its initial collection (`components/holidays-board.tsx:21,45,60`) | `const [holidays] = useState(initialHolidays)` never adopted refreshed props | The board adopts `initialHolidays` whenever the server re-renders; the add form keeps its draft on failure and gains a persistent label; thrown failures are reported | `tests/mobile/holidays-refresh.test.tsx`; browser: added “P2 Test Closure” (appeared without reload), removed it (disappeared without reload), Founder's Day unaffected | fixed-and-verified | Removal still has no named confirmation dialog (visual-redesign item; the remove button already carries an aria-label) |
| O-9 | Vocabulary exposed locales the server rejects; editor state survived locale switches (`lib/actions/terminology.ts:32,39`; `components/terminology/terminology-form.tsx:80–101`) | Action accepted only `locale: "en"`; hi/bn rendered editable inputs with Save; state was not keyed by locale; samples said every term was “marked present” | `WRITABLE_LOCALES` exported and used by the action schema; hi/bn render read-only with an explanatory banner and no Save/reset; the page keys the form by locale; per-term sample sentences (“Primary guardian”, “3 enquiries awaiting follow-up”); save/reset handle thrown failures | `tests/mobile/terminology-locale.test.tsx`; `tests/tier1/terminology-preview.test.ts` still green (generic `SAMPLE_SENTENCES` export unchanged); browser: Hindi read-only, English editable, draft typed in English did not survive a hi→en round trip | fixed-and-verified | Hindi/Bengali writes remain unimplemented by design (no translation engine added); `SAMPLE_SENTENCES` keeps its pinned generic shape while the UI uses per-term context |
| O-10 | Invalid plan prices could silently succeed or coerce to ₹0 (`components/plan-manager.tsx:260–261,352–355`) | Activate silently returned on a bad price; row edit omitted the rejected price while saving the name and reporting “Saved.”; custom plan coerced invalid input to `amountPaise: 0` | A shared `parsePlanPrice` rejects empty/malformed/unsupported precision/≤0/too-large with a field error; every form validates all fields before submitting (atomic reject); valid saves send the exact integer paise | `tests/mobile/plan-price-validation.test.tsx` (malformed edit rejected without action call, zero/negative rejected, valid name+price submitted together); browser: custom plan “12.345” showed “Enter a price in rupees…” with `aria-invalid` and no write | fixed-and-verified | Free plans are not a supported rule (server minimum is 1 paise); the error copy says so implicitly |
| O-11 | Attendance CSV omitted the displayed facility scope (`components/reports/attendance-report-card.tsx:32`; `lib/actions/owner-reports.ts:82`) | The link carried only from/to; the action ignored a location; the service had no caller-location predicate | Link carries `locationId`; the route forwards it; the action uses the facility-aware schema; `getAttendanceReport` applies `resolveLocationAccess`/`locationPredicate` so a restricted caller can never widen, and an explicit facility can only narrow | `tests/mobile/attendance-csv-scope.test.tsx`; `tests/review-owner-ui-remediation.test.ts` (all-locations list, caller narrowed, disallowed facility returns empty, explicit narrowing); browser: fetched the link and the CSV's 7 batch rows matched the displayed facility-scoped list exactly | fixed-and-verified | — |

## P2 — context, recovery, permissions, accessibility, copy

| ID | Finding | Fix | Verification | Status | Remaining limitation |
|---|---|---|---|---|---|
| O-12 | Schedule view/location changes lost the selected date; batch report link had `to == from`; rolling ranges said “this month”; exclusive upper bounds read as inclusive | `OwnerScheduleGrid` takes an `anchor` and carries `date` in view links and the location form; the batch page uses its already-computed `currentMonthPeriod`; dashboard trends say “last 30 days” and the mobile drill adds one day to the exclusive bound; new `formatPeriodRangeIST` labels inclusive ranges on the reports and fees pages | `tests/mobile/owner-schedule-grid.test.tsx` (updated selector, anchor default); browser: week→month and location apply both kept `date=2026-10-20`; reports header “This calendar month: 1 Oct 2026 – 31 Oct 2026”; dashboard trends “last 30 days” at 390 | fixed-and-verified | Month view remains stacked day sections (redesign item); labels now state the real range |
| O-13 | Thrown failures left pending state stuck and drafts unrecoverable in notes, subscriptions, staff create/invite, leave review, branding, batch editors and business hours | Every affected mutation wraps `await` in try/catch/finally; failures keep drafts and report near the workflow; reads that can fail (notes, coverage check, business hours) distinguish failure from empty and offer retry; uncertain mutations say to check before retrying | `tests/mobile/leave-coverage-recovery.test.tsx` (failed coverage ≠ empty, retry, thrown decision keeps the panel); existing notes/subscription/branding tests green; typecheck/lint | fixed-and-verified | Announcements already had this shape; no new idempotency mechanism was needed beyond the server's existing replay-safe operations |
| O-14 | Readable pages exposed writable forms without the independent write permission | `/owner/members/import` now requires `members.write` at page level (matching its actions); member create/edit, branding, vocabulary, invitations and announcements pages already gate their write keys (verified by reading the page guards and action maps) | `tests/mobile/import-page-guard.test.tsx` (members.read-only role 404s, members.write renders) | fixed-and-verified | Tenant-edited custom roles with read-only grants are covered by the same page/action gates; server actions remain the authority |
| O-15 | Placeholder-only labels, missing accessible names, undersized targets, misleading report title, implementation-language leaks | Persistent labels added to member create/edit, enquiry capture, holiday form and guardian fields; business-hours checkboxes/time inputs have per-day accessible names and a 44px label row; configuration values are human; “Collections vs expenses” retitled “Collections” with an honest note; staff-detail roadmap prose replaced with an Invitations link; “Phone (E.164)” reworded; plan price errors use neutral ink (semantic tokens stay money/attendance-only) | `tests/tier1/semantic-token-reservation.test.ts` green; `pnpm check:focus-contrast` green; browser: business-hours “monday open” checkbox name, config and reports copy verified | fixed-and-verified | Deeper focus/contrast measurement remains `pnpm check:focus-contrast`; historical contrast findings were not recycled |

## Prompt 1 unresolved failures (recorded separately, not closed by Prompt 2)

The final combined suite is green except these human-owned or
pre-existing failures, all present at the recorded Prompt 1 baseline:

1. `tests/tier1/platform-entitlements.test.ts` — closed catalogue is 35
   keys with `levels.write` (pin expects 34). Prompt 1 contract change.
2. `tests/tier1/platform-tenants-create.test.ts` — seven seeded role
   templates (pin expects six). Prompt 1 contract change.
3. `tests/tier1/roles-permissions.test.ts` — seven system roles, owner/
   admin lose `attendance.mark`, curriculum_lead gains `levels.write`.
   Prompt 1 contract change.
4. `tests/tier1/role-gating-matrix.test.ts` + `tests/tier1/role-gating-sub-pr1.test.ts`
   — worker maps to `SURFACE_WORKER`; owner `attendance.mark` rows.
   Prompt 1 contract change.
5. `tests/tier1/platform-auth-actions.test.ts` — legacy password/TOTP
   expectations superseded by the OTP design (pre-existing, documented
   in the Prompt 1 ledger).
6. `tests/tier1/attendance-history.test.ts` — fixture time bomb
   (enrols with the current date, then marks June sessions), pre-existing.
7. The reported Owner/Admin `levels.write` backfill remains an
   unresolved Prompt 1 **policy question**; Prompt 2 did not expand or
   contract that authority.

Prompt 2 additionally found and fixed one Prompt 1 test-mock gap:
`tests/mobile/phone-display-sweep.test.tsx` mocked `@/lib/auth/permission`
without `hasPermission`, which the Prompt 1 coach-Me curriculum entry
calls; the mock now returns `false` for an ordinary coach. No assertion
was weakened.

## Verification record (final combined tree)

Environment: disposable `postgres:16` containers on `127.0.0.1:55441` —
`aqua_final` (clean, `pnpm db:deploy`, 110/110 migrations) for the final
suite, `aqua_test` (demo-seeded) for browser journeys. The shared dev
`aqua-db` was not reset or modified.

- `pnpm typecheck` PASS · `pnpm lint` PASS (0 warnings).
- Scanners: `check:migrations` (110), `check:location-scope`,
  `check:tenant-conventions` (42 new), `check:ops-actions`,
  `check:focus-contrast` PASS.
- `pnpm test:sharded` (clean DB, final tree): **366/366 files; 2,760
  passed, 16 failed, 8 skipped; 7 failing files** — every failure is one
  of the Prompt 1 human-owned pins above. No Prompt 2-caused failure
  remains. Evidence: `/tmp/aqua-test-shards-PDV3m2/`.
- New regressions: `owner-fees-scope`, `inline-edit-patch`,
  `member-import-identity`, `collections-report-scope`,
  `roster-publish-scope`, `invitations-revoke-confirm`,
  `owner-config-structured`, `terminology-locale`,
  `plan-price-validation`, `attendance-csv-scope`, `holidays-refresh`,
  `leave-coverage-recovery`, `import-page-guard`,
  `review-owner-ui-remediation` (DB-backed) — all green.
- `pnpm build` PASS; `pnpm check:bundle` 101 routes within budget;
  `pnpm check:fonts` 55.2/60 KB.
- Browser journeys (dev server against the demo-seeded disposable DB,
  owner `+919000000001`/PIN): O-1, O-2, O-4, O-5, O-6, O-7, O-8, O-9,
  O-10, O-11, O-12 at 1280×900; mobile 390×844 overflow probes on fees,
  collections, invitations, configuration and plans all
  `scrollWidth == clientWidth`; trends copy verified at 390.
  Screenshots: `.playwright-mcp/review-p2-owner-home-mobile.png`,
  `.playwright-mcp/review-p2-invitations-mobile.png`.

### Test-isolation note (pre-existing, not a Prompt 2 regression)

Running the suite against a **demo-seeded** DB makes
`tests/migrations/invite-persons-staff-backfill.test.ts` fail: the demo
seed links the same `users` rows into two tenants (`demo-academy`,
`kicks-academy`) with `users.person_id = NULL`, and the applied
migration `20260911120000_invite_persons_staff_backfill.sql` links a
global user's `person_id` from one membership and then inserts a staff
row in the other tenant, violating `staff_person_id_tenant_id_fkey`.
The migration and test files are unchanged by Prompt 1/2
(`git diff` empty); the failure appears only with shared multi-tenant
demo users. The final suite therefore runs on a clean deployed DB, the
same environment the Prompt 1 ledger used. Fixing the applied
migration is not permitted (forward-only, never edit an applied
migration); a future forward migration or a demo-seed change is the
human-owned correction.

### Line-budget note (report-only)

`pnpm check:lines` reports `plan-manager.tsx` (644) and
`collections-report.tsx` (549) above the 350-line hard limit; both were
already over at the recorded baseline (542 and 468). The Prompt 2
rewrites of `staff-roster-board` (split into
`components/roster/*`), `owner-config-form` (helpers moved to
`components/settings/owner-config-values.ts`), `terminology-form`
(shared helpers in `components/terminology/terminology-shared.tsx`) and
`inline-edit-field` (control extracted to
`components/member-detail/inline-edit-control.tsx`) are all back under
the limit. `check:lines` is report-only, not a CI gate.

## Remaining issues / handoff

- The seven tier1 pins above need human owners to update the protected
  expectations to the Prompt 1 contracts (or revert those contracts by
  decision). Prompt 2 must not edit them.
- The Owner/Admin `levels.write` policy question stays open.
- Visual redesign is deliberately untouched; these fixes keep the
  current visual system. The affected workflows are ready to be
  restyled (their data scope, state and recovery behaviour is now
  correct), with these design items still outstanding: named removal
  confirmation for holidays, staff-invitation name projection,
  reconciliation “lane” label, and the schedule month view.
