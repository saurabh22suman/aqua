# Mobile UX improvement plan — Aqua (v2)

**Status:** v2, 2026-09-12. Supersedes v1 of this same file.
**Basis:** the mobile UI/UX audit (findings F1–F40, severities P0–P4),
plus (a) a file-by-file verification of v1 against the working tree at
`a2de1cc`, and (b) India-specific device/behaviour research. v1 made
~15 claims that did not survive verification; every correction is
recorded in "Dropped or re-scoped findings" below rather than silently
lost.

Goal unchanged: lift the role scorecard **6.1 → 8.3** with minimum
code changes and zero new dependencies.

Audience: the implementer running against `localhost:3211` (dev) and
the mobile viewport **360 × 800** — the single most common Indian
mobile canvas (18.5 % of mobile traffic, Statcounter Aug 2026). The
audit's 390 × 844 is above that median; 360 is the design target.
Design rules live in `DESIGN.md`, which is non-negotiable; where this
plan and `DESIGN.md` disagreed, the plan lost (see decision 6).

---

## Indian device context (updated)

- **Resolutions (Statcounter, Aug 2026, mobile):** 360×800 **18.5 %**,
  393×873 8.4 %, 360×804 4.7 %, 393×876 4.0 %. Design at **360**, tune
  at 393.
- **OS:** Android 92.8 %, iOS 7.2 %. Budget/mid-range Android dominates:
  Vivo, Xiaomi, Realme, Oppo, Samsung ≈ 70 % of devices. Assume
  4–6 GB RAM, 720p, Android 11–16, WebView-class rendering.
- **Network:** Jio + Airtel ≈ 77 % of subscribers; 31 GB/user/month
  average data; 5G is ~47 % of traffic but 4G fallback is common. Cost
  is not the constraint — latency, jitter and device CPU are.
- **Behavioural implications:**
  - Single-handed thumb arc; primary actions bottom-anchored; rare /
    hard-to-reach actions may sit top-right. Bottom nav with **text
    labels** beats hamburger (Indian experiments report materially
    higher discovery and engagement with bottom nav + labels).
  - Trust cues: phone as `+91 98123 40010`, dates as `12 Sept 2026`,
    money grouped Indian-style (`₹1,00,000`). Never `mm/dd/yyyy`.
  - Destructive confirmation is familiar from UPI apps; keep the
    deliberate confirm pattern. Do **not** add a toast/undo system
    (approved decision 5) — for irreversible actions a confirm is the
    right pattern, and the repo already has three shipped variants
    (see "Existing confirm patterns" below).
  - Offline/patchy connectivity is real: prefer explicit
    "saved / will sync" states over optimistic success; never a green
    success before the server confirms money writes.
  - Mixed-language tenants exist (Hindi, Bengali, …). Vocabulary must
    flow through `resolveTerm()`; `tests/tier1/vocab-source-scan.test.ts`
    already enforces this mechanically.

---

## Approved decisions (revised)

| # | Decision | Direction |
| - | -------- | --------- |
| 1 | F4 (Coach → Me crash) | Remove `requirePermission(ctx, "members.read")` from `app/(coach)/coach/me/page.tsx:17`. **Do not** grant the coach role the permission. |
| 2 | F5 (Reception 404) | `/reception` is a reception-only page (`requireReception()`), so the today card is never a valid link there. Render a static card with "Coach will mark attendance." Do not build a new register view. |
| 3 | Phone display format | `+91 98xxx xxxxx` (5 + 5). New `formatPhoneIN()` helper in the existing `lib/phone.ts`. |
| 4 | Ops mobile nav | Bottom bar with **exactly four** items (Overview, Tenants, Feature catalogue, Presets), matching the tenant surfaces. No hamburger. Sign-out moves into the mobile header, not the nav (the four-item rule is absolute). Requires the `DESIGN.md` amendment in decision 6. |
| 5 | Destructive confirmations | Keep the existing confirm patterns; do not introduce a toast/undo system. F35's "red churn button" is **dropped** — red is reserved for overdue/absent by `DESIGN.md` §1.1; the existing required-reason modal already gates churn. |
| 6 | `DESIGN.md` | `DESIGN.md:175` says `/ops` is desktop-only, which contradicts decision 4. Amendment in this PR: `/ops` stays desktop-first (sidebar, tables, console type) but gains a supported mobile console — four-item bottom nav, table→card lists, sign-out in the mobile header, 44px targets on the mobile nav/cards. |
| 7 | Test mechanism | v1 specified Playwright inside `tests/tier1/`. That is not this repo's convention: tier1 is Vitest (jsdom + Testing Library, or real-DB page drives); Playwright lives in `scripts/e2e-*.ts`. This plan uses tier1 conventions; real-viewport Playwright checks stay in scripts and are out of scope for these phases. |

---

## Code-change discipline

- **No new dependencies.** Reuse `lib/time/tz.ts`, `lib/phone.ts`,
  `lib/terminology/keys.ts`, `components/bottom-nav.tsx`, the existing
  `signOutFormAction` (`app/(platform)/layout.tsx:112`).
- **Additive.** New files: `components/ui/EmptyState.tsx`,
  `components/ui/Row.tsx`, `components/ui/Tap.tsx`,
  `components/ui/FieldError.tsx` (and in later phases `BackLink`,
  `ConfirmDialog`). No restructuring.
- **TDD.** Every fix starts as a failing test that reproduces the bug
  shape, then the code change makes it pass. Timezone and permission
  fixes additionally get a mutation proof (revert the fix, watch the
  test go red) per the `execute-task` skill.
- **Touch targets:** `DESIGN.md` §2 floor is 44 × 44px; `<Tap>` defaults
  to 44. Primary actions may use 48 (research preference for budget
  Android) via `<Tap min={48}>`.
- **Hold at 360 × 800.**
- **Vocabulary:** any string naming member/batch/coach/session/program/
  facility/guardian/enquiry goes through `resolveTerm()`; the existing
  source scan will fail the build otherwise.

---

## Phase 0 — One-line critical fixes

Five P1s. Each is a small, surgical change; the file targets below are
the verified ones from v2 (v1 had four wrong references).

### F3 — `/owner/sessions` renders UTC instead of IST (P1)

`components/upcoming-sessions-list.tsx:14-19` formats with
`getUTCHours()`/`getUTCMinutes()`. Replace with the new zone-aware
helper.

Add to `lib/time/tz.ts`:

```ts
export function formatDateIST(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

export function formatTimeIST(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}
```

`formatTimeIST("2026-09-12T11:30:00Z")` → `05:00 pm`.
`formatDateIST("2026-09-12T11:30:00Z")` → `12 Sept 2026`.

Then replace `formatTime` in `components/upcoming-sessions-list.tsx`
(use it at both call sites — the row range **and** the
`SessionSubstituteControl` props). `formatHeaderDate` already renders
IST and stays.

### F4 — Coach `Me` crashes with `ForbiddenError` (P1)

`app/(coach)/coach/me/page.tsx:17` — remove
`requirePermission(ctx, "members.read")`. `requireCoach()` (line 15)
and `requireDefaultCtx()` (line 16) already guard the route; the page
only needs the signed-in user's identity.

### F5 — Reception today card links to coach-only 404 (P1)

The link is at `app/(reception)/reception/page.tsx:35-53` — **not** in
`components/register-board.tsx` (v1 error). The page is reception-only,
so every card there links a role that cannot open
`/coach/register/[sessionId]`. Replace the `<Link>` with a `<div>` and
add the static line "Coach will mark attendance." under the row
metadata. Keep the lane strip.

### F6 — Member detail enrolment select overflow (P1)

`components/member-enrolment-panel.tsx:149-153`. The row already has
`flex flex-wrap` (v1 misdiagnosed this); the overflow comes from the
`<select>`'s intrinsic min-content width (longest option text). Give the
select `w-full min-w-0` so it wraps to its own full-width line and can
shrink below its min-content width. Leave the button as is.

### F7 — Batch add/edit capacity+time row overflow (P1)

`components/batch-create-form.tsx:114-135` and
`components/batch-edit-form.tsx:139-160`: the row is `flex gap-2` with
no wrap. Add `flex-wrap` to the row; add `min-w-0` to the two time
inputs (capacity stays `w-24`). The three controls then wrap to two
lines at 360 instead of pushing past the viewport, and the time inputs
may shrink.

### Phase 0 tests (written first, must fail)

| Test file | Proves |
| --- | --- |
| `tests/tier1/time-format.test.ts` | `formatTimeIST`/`formatDateIST` outputs, including the 11:30Z → `05:00 pm` case |
| `tests/tier1/upcoming-sessions-list.test.tsx` | rendered list shows `05:00 pm`, not `11:30` (jsdom + RTL, substitute control stubbed) |
| `tests/tier1/coach-me-page.test.ts` | real-DB coach context drives `CoachMePage()` without throwing and renders identity (mutation: re-adding the permission line turns it red) |
| `tests/tier1/reception-today-page.test.tsx` | page tree contains no `/coach/register/` href and shows the static copy |
| `tests/tier1/mobile-overflow-guards.test.tsx` | enrolment select has `w-full`/`min-w-0`; batch capacity/time rows have `flex-wrap`; time inputs have `min-w-0` |

### Expected score after Phase 0

Owner 7.5 (+1.0), Staff 7.5 (+1.0), Coach 8.0 (+1.5). Overall 6.8 (+0.7).

---

## Phase 1 — Shared "design system lite"

Four small components that compose away ~12 audit findings, then wire
them into the screens where behaviour is already being touched. Phase
1a is components + tests; 1b is call-site wiring. Split so the
component PR can land without screen churn.

### 1a — Components (`components/ui/`)

- `<EmptyState icon title body action?>` — `EmptyState.tsx`.
  Boring props so it drops in anywhere:
  ```ts
  type EmptyStateProps = {
    icon?: ReactNode;
    title: string;
    body?: string;
    action?: { label: string; href?: string; onClick?: () => void };
  };
  ```
- `<Row label value action?>` — `Row.tsx`. Visible label + value +
  optional action, for member detail data lists, ops tenant settings,
  onboarding step rows. Fixes F37 and the `h1` edit-button anti-pattern.
- `<Tap min={44}>` — `Tap.tsx`. Wraps an interactive child and enforces
  a minimum hit area (`min-h-11 min-w-11`, i.e. 44px) without changing
  layout. Fixes F9/F10/F11/F25.
- `<FieldError>` — `FieldError.tsx`. Per-field error message with an
  icon, `role="alert"` and an `id` an input can reference via
  `aria-describedby`. Replaces the combined-error pattern (login, add
  member, enquiry follow-up). Deliberately **neutral colour**: the
  semantic tokens (`good`/`late`/`warn`) are reserved for money and
  attendance state (DESIGN.md §1.1), and
  `tests/tier1/semantic-token-reservation.test.ts` is right to reject
  a form error wearing `late`. The message text is the signal.

### 1b — Call-site wiring (scoped)

- **EmptyState** at the four highest-signal empties: members board empty
  search (F19), register board zero-enrolled (F22), owner sessions empty
  (F3 file, same edit), reception today empty (F5 file, same edit).
- **Tap** at icon-only controls: program/batch edit + delete icons in
  `components/programs-batches-board.tsx`, session substitute trigger in
  `components/upcoming-sessions-list.tsx`, enquiry stage buttons in
  `components/enquiry-detail-view.tsx`.
- **Row and FieldError** are built and unit-tested in 1a; their screen
  wiring happens in Phase 3 (where those forms are already being touched
  for vocabulary/error work). This keeps 1b from becoming a rewrite.

### Phase 1 tests

- `tests/tier1/ui-components.test.tsx` — one describe per component;
  includes a mutation-style planted case proving empty-state copy
  appears only when the list is empty.
- Extend `tests/tier1/members-board.test.ts(x)` / add jsdom tests at the
  wired call sites asserting the empty-state copy and ≥44px classes on
  the wrapped controls.

### Expected score after Phase 1

Owner 8.0, Staff 8.0, Coach 8.5. Overall 7.4.

---

## Phase 2 — Ops becomes a mobile console

Requires the `DESIGN.md` amendment (decision 6) in the same PR.

### F1 — Mobile nav + sign-out on Ops

`app/(platform)/layout.tsx`. Add a `md:hidden` instance of the existing
`BottomNav` with four items: Overview (`/platform`), Tenants
(`/ops/tenants`), Feature catalogue (`/ops/features`), Presets
(`/ops/presets`). No BottomNav extension needed — sign-out does **not**
go in the nav (four-item rule). Instead, add a `Sign out` form to
`MobilePlatformHeader` (lines 76–87) using the existing
`signOutFormAction`. Add bottom padding to the content wrapper so the
fixed bar never covers content.

`BottomNav` needs two new icon entries in its closed registry
(e.g. `building-2` for Tenants, `sliders-horizontal` for Presets);
Overview and Feature catalogue can reuse existing `layout-dashboard` /
`list-checks`.

### F2 — `/ops/tenants` table → card list on mobile

`app/(platform)/ops/tenants/page.tsx`. Render a `md:hidden` `<ul>` of
tenant cards (name, slug, status pill, members/locations counts,
chevron) and wrap the existing table in `hidden md:block`. Drop the
blanket `overflow-hidden` from the table container (use
`overflow-x-auto` on the md+ wrapper); the card list uses `EmptyState`
from Phase 1. Bump the search/filter inputs to `text-[16px]` so the
mobile list doesn't zoom-on-focus on iOS. There is **no CSV export** on
this page — v1's risk note was based on a non-existent feature; remove
it.

### F34 — Presets card on `/ops` home

`app/(platform)/ops/page.tsx`: a fourth card linking `/ops/presets`
the grid already flows `sm:grid-cols-2`.

### F35 — "Mark churned" destructive treatment (re-scoped, no code)

`app/(platform)/ops/tenants/[tenantId]/status-transitions.tsx` already
gates churn behind a required-reason modal with an explicit
`Confirm Mark churned` button (lines 87–105, 161–217). `DESIGN.md`
§1.1 reserves red for attendance state, and the file's own comment
documents the choice. No colour change; no code change. If a stronger
cue is wanted later, the compliant lever is copy/placement, not colour
— and that is a design decision, not a bug fix.

### Phase 2 tests

| Test file | Proves |
| --- | --- |
| `tests/tier1/platform-mobile-shell.test.tsx` | authenticated platform layout renders the four-item mobile nav and a mobile-header sign-out form; no fifth nav item (four-item rule) |
| `tests/tier1/ops-tenants-mobile.test.tsx` | with mocked `listTenants`, the card list renders per-tenant counts; table is `hidden md:block`; no `overflow-hidden` on the mobile path |
| `tests/tier1/ops-home-cards.test.tsx` | Presets card exists and links `/ops/presets` |
| `tests/tier1/input-font-size.test.ts` | existing scan stays green (ops search/filter inputs now 16px too) |

### Expected score after Phase 2

Ops 7.5 (+3.0). Overall 7.7.

---

## Phases 3–5 (corrected, for later)

Not part of the current implementation batch. Corrections applied from
verification so nobody implements a stale finding.

### Phase 3 — Indian trust + polish

- `formatDateIST`/`formatTimeIST` reused across **~10** ad-hoc
  formatters (v1 said four): `app/(coach)/coach/page.tsx`,
  `coach/schedule/page.tsx`, `coach/register/[sessionId]/page.tsx`,
  `reception/page.tsx`, `reception/members/[memberId]/page.tsx`,
  `owner/members/[memberId]/page.tsx`, `owner-dashboard.tsx`,
  `app/p/[token]/route.ts`, `use-offline-register.ts`,
  `upcoming-sessions-list.tsx`.
- `formatPhoneIN()` in `lib/phone.ts`, applied at owner/coach member
  list + detail and ops staff list.
- F18 vocabulary: fix the real leaks — `member-create-form.tsx` (lines
  113, 279, 306–307, 330), `members-board.tsx:110`,
  `owner/members/page.tsx:17`, `coach/members/page.tsx:16,23,25` —
  through `resolveTerm()`; do not add a dotted `term.member.singular`
  key (that shape doesn't exist; the resolver takes `("member", 1)`).
- F31 copy: "synced" is emitted in `components/register-board.tsx:125`
  and `:130`, not in the hook (line 293 only builds the time). Upgrade
  the label to an explicit `Saved at HH:MM` / `Saved · waiting to sync`
  pair per the offline research.
- F17: date inputs currently have no `lang`/placeholder; no
  `mm/dd/yyyy` literal exists in source. This is additive polish, not a
  bug fix.

### Phase 4 — Consistency backstops

- F26 owner nav: path is `app/(owner)/layout.tsx` (v1 wrong). Adding
  Sessions + Enquiries makes **six** items, which violates
  `DESIGN.md`'s exactly-four rule and M3's 3–5 cap. Needs a real
  navigation decision (which two items move or get merged) before code.
- F13 BackLink at the five detail pages listed in v1.
- F29: the redundant `Sat ·` prefix renders at
  `app/(coach)/coach/schedule/page.tsx:35`, not :27.
- F10/F12: delete program/batch already have inline two-step confirms
  (`programs-batches-board.tsx:184–211`, `276–303`). Migration to a
  shared `<ConfirmDialog>` is optional consistency work, not a missing
  guard.
- F27 onboarding: real duplication is `onboarding-checklist.tsx:100`
  (`Done` subtitle) + `:104–107` (second `Done` pill); renaming "What's
  left" to "Setup" would duplicate the hero label at line 42 — pick one.

### Phase 5 — Visual polish

- F23 identity QR card (`components/member-id-card.tsx`) is an async
  server component rendered above the `h1`; collapsing needs a client
  boundary or `<details>`.
- F36 KPI labels `text-[11px]` → 13–14px (`owner-dashboard.tsx:82,88,92`);
  research floor for readable secondary text is 14px.
- F21 today card: more than the date label differs from "Up next"
  (colour, CTA, progress bar, copy) — a parity pass, not a one-liner.
- F22 register empty copy via `<EmptyState>` (partially done in 1b).

---

## Dropped or re-scoped findings (why)

| Finding | v1 claim | Reality | Action |
| --- | --- | --- | --- |
| F28 | "Enrol → Enrol (UK fix)" | Codebase already uses `Enrol`, `Enrolment`, `Enrolling` | Dropped |
| F35 | No destructive colour **and** no confirm | Required-reason confirm modal already ships | Red dropped (DESIGN §1.1); no code |
| F10/F12 | Delete actions unguarded | Both have inline two-step confirms | Re-scoped to optional dialog migration |
| F17 | `mm/dd/yyyy` found in forms | No such literal; inputs lack `lang`/placeholder | Re-scoped as additive polish |
| F6 | Row needs `flex-wrap` | Row already `flex flex-wrap` | Target narrowed to the `<select>` |
| F5 | Card lives in `register-board.tsx` | It lives in `app/(reception)/reception/page.tsx` | Target corrected |
| Ops CSV | Mobile risks losing CSV export | No CSV export exists in `/ops` | Risk removed |
| F26 | `owner/owner/layout.tsx`, support 5 items | Actual path `app/(owner)/layout.tsx`; 4+2 = 6 | Deferred pending a nav decision |
| Nav | `computeBottomNav` / `findActiveHref` "already handles" | `computeBottomNav` doesn't exist; `findActiveHref` is private | Plan describes real component |
| Phone helper | `lib/phone/format-in.ts` (new) | Existing `lib/phone.ts` is the additive home | Path corrected |
| Tests | Playwright in `tests/tier1/` | Tier1 is Vitest/jsdom; Playwright lives in `scripts/e2e-*` | Test mechanism corrected |

---

## Expected score trajectory

| Role | Current | After P0 | After P1 | After P2 | After P3 | After P4 | After P5 |
| ---- | ------: | -------: | -------: | -------: | -------: | -------: | -------: |
| Ops  |  4.5    |  4.5     |  4.5     | **7.5**  |  8.0     |  8.0     |  8.0     |
| Owner|  6.5    |  7.5     |  8.0     |  8.0     |  8.0     |  8.5     |  8.5     |
| Staff|  6.5    |  7.5     |  8.0     |  8.0     |  8.5     |  8.5     |  8.5     |
| Coach|  6.5    |  8.0     |  8.5     |  8.5     |  8.5     |  8.5     | **9.0**  |
| Student (parent-link) | 6.5 | 6.5 | 7.0 | 7.0 | **7.5** | 7.5 | 7.5 |
| **Overall** | **6.1** | **6.8** | **7.4** | **7.7** | **7.9** | **8.0** | **8.3** |

Note on the parent score: parents are WhatsApp-first; the parent-link
portal is not their main trust channel. The plan's low parent weighting
undercounts the product's real parent experience. A WhatsApp/SMS
notification strategy belongs in a separate plan, not here.

---

## Release sequencing

1. **Docs** — this file + `DESIGN.md` amendment (decision 6).
2. **Phase 0** — `fix: mobile P1 correctness` (F3–F7), tests included.
3. **Phase 1** — `feat: shared UI components` (components + scoped
   wiring), tests included.
4. **Phase 2** — `feat: ops mobile console`, tests included.
5. Phases 3–5 after the above merge; Phase 4's nav change needs a
   decision first.

Each PR stays under 300 LOC net (test files exempt per AGENTS.md).

---

## Risks and watch-outs

- **F3 timezone:** verify both the row range and the
  `SessionSubstituteControl` props use the helper. Substitution audit
  rows must stay IST too.
- **F4 permission:** the correct fix removes the check, not grants the
  permission. Mutation-proof this by re-adding the line in a scratch
  change and watching `coach-me-page.test.ts` fail.
- **Phase 1b wiring:** components landing without call sites is fine;
  call sites landing without components is not. Keep 1a green first.
- **Phase 2 nav:** the four-item rule is absolute — sign-out lives in
  the header. If a fifth destination ever seems necessary, revisit the
  information architecture, don't extend the bar.
- **Native `<dialog>` (Phase 4):** safe on Chromium Android and iOS
  ≥ 15.4, but background scroll-lock needs a shim and `::backdrop`
  needs hardcoded colours on iOS Safari. This is why the existing
  confirm patterns are not being ripped out mid-flight.
- **`/ops` mobile forms:** the console's data-entry forms remain
  desktop-first by decision 6; only the tenants filter inputs are
  bumped to 16px. Don't accidentally start a whole mobile-forms pass
  inside Phase 2.

---

## Out of scope (explicit non-goals)

- No new feature work. Everything here is a layout, copy, or bug fix.
- No new design-system tokens.
- No new dependencies (no sonner, no radix, no chart libs).
- No migration of existing data.
- No change to the Coach `Me` route's permission model beyond removing
  the wrong check (decision 1).
- No new Reception register view (decision 2).
- No toast/undo system (decision 5).
- No hamburger menu on Ops (decision 4).
- No WhatsApp/SMS notification work — separate plan.

---

## Done definition (per phase)

- New tests fail before the fix and pass after; shown in the PR.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.
- `pnpm check:lines` reports no new files over 300 lines.
- Screenshots at 360 × 800 for every changed screen saved under
  `.playwright-mcp/audit/post-imp-plan/` and compared with
  `.playwright-mcp/audit/`.
- The scorecard row for the phase matches the measured result.
