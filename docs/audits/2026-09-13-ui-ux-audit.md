# Aqua — Deep UI/UX Design Direction Audit

**Date:** 2026-09-13
**Auditor:** Senior product designer / UX researcher / design-system architect (via Playwright MCP, live browser testing — not source-reading)
**Supersedes:** the 2026-09-12 `AUDIT-REPORT.md` (mobile-UX sweep, PR #137). This is a full fresh audit against the same product, one day and one feature wave (R.5–R.8: waitlist, batch transfer, makeup credits, absence alerts) later. Where a prior finding was re-tested, the result is stated explicitly as **CONFIRMED**, **FIXED**, or **NOT RETESTED** — nothing is carried forward silently.
**References used as design authority:** `docs/sports-club-ui-direction.html` (visual/layout reference), `docs/how-it-works.html` (product philosophy), `docs/architecture.md` (structure, roles, entitlements, terminology), and **`DESIGN.md`** (repo root) — the actual non-negotiable token/rule spec, which in places supersedes and sharpens the HTML reference (e.g. touch targets are a hard 44×44px minimum, not the HTML mock's softer framing; there's a documented third semantic color, `warn`).
**Viewports:** 390×844 primary, 375×812 and 430×932 spot-checks, plus 1280×900 desktop for Ops (which `DESIGN.md` explicitly designates desktop-first).
**Tenant:** "Aqua Worli Aquatic Club" (slug `demo-academy`), terminology preset active (member → "Swimmer").
**Roles tested:** Owner, Coach, Receptionist, Parent (`/p/[token]` live magic link + `/parent` stub), Platform/Ops. **Ground Staff: could not be tested — no route group exists in the codebase** (`find app -maxdepth 2 -type d` shows only `(auth)`, `(coach)`, `(owner)`, `(parent)`, `(platform)/ops`, `(reception)`, `p/[token]`). This is a documented open decision (`docs/role-surfaces-plan.md` §7.2), not a defect — no screen exists to score.

---

## 0. Environment notes (read before the findings — affects how to interpret some of them)

- The dev server had a stale `.next` build and a stale service-worker cache from a prior session; both were cleared before testing began. One transient client crash on the very first `/owner` load was a webpack compile race, not reproducible after a clean reload — excluded from findings.
- I ran `pnpm seed` once at the start of this session; it appended 16 "Synthetic Member NN" rows to the Members list (the seed script's member-creation step is not idempotent on rerun). This is real seed-tooling debt worth fixing, but it is not a product UI defect and is excluded from the findings below — it only explains the extra rows visible in Members-list screenshots.
- The receptionist demo login (`+919000000005`) had a stale `coach` role membership from an earlier seed run (`onConflictDoNothing` silently kept it). **With explicit user approval**, I corrected that one `tenant_memberships.role_id` value directly so Reception could be tested. This is noted because it explains a data-identity mismatch found on Reception's own "Me" page (see R4).
- **With explicit user approval**, I seeded one platform-operator account (`ops@aqua.test`) via `DEMO_MODE=true pnpm tsx scripts/seed-platform-user.ts` to test the Ops surface — this repo's `.env` had no platform credentials configured.
- I did **not** retest the prior audit's P0-1 (ZodError leak on an invalid member ID) or P0-3 (Sessions page showing UTC instead of IST). These are flagged as **NOT RETESTED** in the appropriate section — treat their prior status as unknown, not resolved, until someone checks.
- Money/billing (dues, fee collection, payment links, invoices) does not exist anywhere in the product yet — this is Wave 3, not started (`docs/role-surfaces-plan.md`). Every finding below treats its absence as expected, not a defect, and notes only where a screen's *copy* implies a capability that isn't there.

---

## 1. Executive summary

Aqua is materially stronger today than the 2026-09-12 snapshot, and the improvement is concentrated exactly where the product's own philosophy says it should be: the **coach register** (mark attendance, offline-safe, reload-tested to actually persist) and the **owner member-detail / settings tree** (vocabulary, branding, absence alerts, makeup credits, parent-link issuance) are genuinely excellent, evidence-backed, production-grade screens. The **zero-JS parent page** (`/p/[token]`) is the single most rule-compliant surface in the app — perfect dates, perfect tokens, perfect privacy copy, confirmed zero client JavaScript.

The prior audit's three P0s have partially improved: the parent surface went from a bare Next.js 404 to a styled (if generic, and non-parent-specific) error page — real progress, downgraded to P2. The other two P0s (ZodError leak, Sessions UTC bug) were not retested this round and should not be assumed fixed.

The biggest **new, well-evidenced, cross-cutting** finding this round is a **systemic status/badge coverage gap**: Owner's Enquiries list, Reception's Enquiries list (same shared component), and Ops's Tenant status all render every lifecycle state in identical, uncolored `ink-2` gray — verified by computed style, not impression — despite `DESIGN.md`'s own opening thesis being "colour means money and attendance state, nothing else." The Members list *does* color-code status correctly; this pattern simply never propagated to the other three lists that need it just as much.

The second biggest finding is a **button-system gap**: there is no shared `Button` primitive. On a single Owner screen, five visually-similar buttons measured five different heights (33/36/38/44px), with the 44px `DESIGN.md`-hard-minimum violated by three of them. Vocabulary settings independently shows eight identically-emphasized primary mango buttons on one screen, diluting the reference's own "mango is the one action" principle.

Two real, repeatable **data-integrity risks** were found on children's records: a native `<input type="date">` on both Owner's and Reception's "Add Swimmer" forms silently renders US `mm/dd/yyyy` regardless of its own `dd/mm/yyyy` placeholder — on a day ≤ 12, a receptionist typing a birthdate day-first will silently store the wrong date. And on Reception's form, the submit button sits physically *before* the mandatory guardian/consent fields in document flow.

**Overall UI/UX: 7.6/10 — Strong Production UI.** Up from the prior audit's 6.6–6.8, on real evidence of both fixes and new feature quality — not a re-scoring of the same material.

---

## 2. Design token model (extracted, used as the comparison baseline throughout)

From `docs/sports-club-ui-direction.html` and `DESIGN.md` (the latter is authoritative where they differ):

| Token | Value | Rule |
| --- | --- | --- |
| Ink / Ink-2 / Ink-3 | `#0F1F1C` / `#3C534F` / `#7B918D` | text |
| Marine | `#0D3B36` | hero blocks, dark surfaces |
| Water / Water-soft | `#0E7C86` / `#E3F1F2` | **data only** — capacity, progress |
| Deck / Paper | `#EDF0EC` / `#FFFFFF` | page bg / card surface |
| Good / Good-soft | `#2E9E5B` / `#E4F4EA` | paid · present |
| Late / Late-soft | `#D8453C` / `#FCE9E7` | overdue · absent |
| **Warn / Warn-soft** | `#B8710A` / `#FDF0DC` | **needs attention** (not in the HTML reference — a `DESIGN.md`-only addition, confirmed live in the codebase) |
| Accent (`mango` default) / soft / ink | `#FF7A18` / `#FFEEE1` / `#B84E00` | **actions only, never status** — six approved values (mango/marine/indigo/plum/forest/slate), tenant-configurable |
| Radii | card `20px`, control `14px`, pill `9999px` | |
| Shadows | sh-1 `0 1px 2px rgba(15,31,28,.05)`, sh-2 `0 2px 6px …, 0 14px 32px …` | **two levels only, never a third** |
| Type | Bricolage Grotesque 600 (display), Instrument Sans 400/500 (body) | weights 400/500/600 only, never 700+ |
| Touch targets | **44×44px minimum, hard rule** | |
| Bottom nav | **exactly four items, no "More" tab, ever** | "if a fifth thing seems necessary, something else is wrong" |
| Dates | `22 Aug`, `Sat 22 Aug` | never ISO, never `mm/dd` |
| Writing | sentence case everywhere, never Title Case | |
| Loading | skeletons only, never spinners | |
| The "lane strip" | label row + 6px pill track, `water`/`warn`/`late` fill | **the signature reusable component** — owner=batch capacity, coach=register progress, parent=membership runway |

Every finding below is measured against this table, with computed-style evidence where a claim is about color, size, or shape.

---

## 3. Lane-strip verification (a named, testable claim from DESIGN.md — resolved directly)

`DESIGN.md` states (as of its last edit) that the owner and parent lane-strip reuses "don't exist anywhere in the codebase yet." This was checked directly, per reuse:

| Reuse | Status | Evidence |
| --- | --- | --- |
| **Owner** (batch capacity, Home "Today's lanes") | ✅ **Implemented — DESIGN.md's claim is stale** | Computed style: 6px track, `#EDF0EC` bg, `9999px` radius; fill `#B8710A` (warn) at `width:0%` for a near-empty batch — correct token, correct logic |
| **Coach** (register/schedule progress) | ✅ **Implemented, with correct dual semantics** | Schedule: `#B8710A` (warn) fill for under-filled enrollment. Inside the register: `#0E7C86` (water) fill for in-progress marking. Same component, two contextually-correct colors — the clearest evidence in the whole audit that "one shape, many meanings" is a real shared pattern, not a coincidence |
| **Parent** (membership runway) | ❌ **Not implemented — DESIGN.md's claim is accurate here** | Full raw HTML of `/p/[token]` read end-to-end: header → member card → next-session card → attendance card → footer. No membership/plan card, no progress track anywhere. Reasonable given Wave 3 billing isn't built yet (the reference's own membership card needs plan/duration data that doesn't exist), but it is a genuine, current gap, not a stale doc claim |

**Recommendation:** whoever owns `DESIGN.md` should update the Owner/Coach lines (both shipped) and leave the Parent line as-is (still accurate) — the doc is half stale, not wholly stale, and treating it as uniformly outdated would hide the one real remaining gap.

---

## 4. Role scorecards

| Role | Visual Design | Design Direction | Usability | Mobile UX | Info Hierarchy | Navigation | Task Efficiency | Product Intent | Consistency | **Overall UX** |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Owner | 8.5 | 8 | 7.5 | 8 | 7 | 7 | 7.5 | 8.5 | 7 | **7.8** |
| Coach | 8.5 | 9 | 8 | 8.5 | 7.5 | 8.5 | 6.5 | 9 | 8.5 | **8.2** |
| Reception | 7 | 6.5 | 7 | 7.5 | 6 | 7.5 | 8 | 7.5 | 6.5 | **7.0** |
| Parent | 8.5 | 8 | 8 | 9 | 8.5 | n/a¹ | 9 | 8 | 7.5 | **8.0** |
| Platform/Ops | 7.5 | 7.5 | 6.5 | 6.5 | 6 | 7.5 | 6 | 7.5 | 6.5 | **6.8** |
| Ground Staff | — | — | — | — | — | — | — | — | — | **untestable — no route exists** |

¹ Single server-rendered page by design; a nav would contradict the "no app, zero JS" premise.

**Ranking, best to weakest experience: Coach → Parent → Owner → Reception → Ops.** This both confirms (Coach still best) and partially revises (Reception, not Owner, is now the weaker mainstream role) the prior audit's ranking — Owner's settings tree and member-detail work raised it meaningfully since 2026-09-12.

---

## 5. Screen-by-screen scorecard

| Screen | Role | Design Match | UX | Mobile | Intent | Overall |
| --- | --- | --: | --: | --: | --: | --: |
| Home | Owner | 9 | 8.5 | 9 | 9 | 8.9 |
| Members list | Owner | 7.5 | 8 | 8 | 7.5 | 7.8 |
| Member detail | Owner | 8.5 | 9 | 8 | 9 | 8.6 |
| Enquiries | Owner | 6.5 | 7 | 7.5 | 7 | 7.0 |
| Programs & Batches | Owner | 7 | 7 | 7 | 7.5 | 7.1 |
| Sessions (substitution) | Owner | 6.5 | 5.5 | 6 | 7 | 6.3 |
| Settings hub | Owner | 9 | 9 | 9 | 8.5 | 8.9 |
| Reports | Owner | 7 | 6.5 | 7 | 7.5 | 7.0 |
| Staff list | Owner | 8.5 | 8 | 8.5 | 8 | 8.3 |
| Onboarding checklist | Owner | 8 | 8 | 8.5 | 8 | 8.1 |
| Branding settings | Owner | 9 | 8.5 | 9 | 9 | 8.9 |
| Vocabulary settings | Owner | 9 | 8 | 9 | 9.5 | 8.9 |
| Absence alerts settings | Owner | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 |
| Holidays & closures | Owner | 8 | 8 | 8 | 8 | 8.0 |
| Add Swimmer form | Owner | 8 | 7.5 | 8 | 8.5 | 8.0 |
| Today | Coach | 7.5 | 6 | 8 | 7 | 7.1 |
| Schedule | Coach | 8.5 | 8 | 8.5 | 8.5 | 8.4 |
| Register (populated) | Coach | 9.5 | 9.5 | 9.5 | 9.5 | **9.5** |
| Register (empty state) | Coach | 9 | 9 | 9 | 9 | 9.0 |
| Members | Coach | 7.5 | 7 | 8 | 7.5 | 7.5 |
| Member detail | Coach | 8 | 7.5 | 8 | 8.5 | 8.0 |
| Me | Coach | 6 | 5.5 | 7 | 6 | 6.1 |
| Today | Reception | 6.5 | 6 | 7 | 6.5 | 6.5 |
| Add Swimmer (incl. minor flow) | Reception | 7.5 | 6.5 | 8 | 8.5 | 7.6 |
| Enquiries | Reception | 7 | 8 | 7.5 | 8 | 7.6 |
| Me | Reception | 6 | 6.5 | 7 | 6 | 6.4 |
| `/p/[token]` (live) | Parent | 8.5 | 8 | 9 | 8 | 8.4 |
| `/parent` (stub) | Parent | 6 | 5 | 7 | 4 | 5.5 |
| Overview | Ops | 7.5 | 6.5 | 7 | 7 | 7.0 |
| Tenants list | Ops | 7 | 6.5 | 7 | 7 | 6.9 |
| Tenant detail | Ops | 6.5 | 5.5 | 5.5 | 6.5 | 6.0 |
| Feature catalogue | Ops | 7 | 5.5 | 6.5 | 6 | 6.3 |

**Standout screen: Coach Register (populated), 9.5/10** — the single best-executed screen in the product. **Weakest mainstream screens: Owner Sessions (6.3) and Ops Tenant detail (6.0)** — both suffer from the same root cause (an admin-table's worth of content dumped onto a mobile-width column with no prioritization), just in different roles.

---

## 6. Design-system scorecard

| Category | Score | Why |
| --- | --: | --- |
| Color | 7.5 | Token *fidelity* is excellent everywhere color is applied (correct warn/good/late/mango reservations, confirmed even in edge cases like the parent page's inline hex values) — but *coverage* has a real, confirmed three-role gap (§7.1) |
| Typography | 8.5 | Bricolage/Instrument Sans, correct weights and sizes, consistent across all 5 roles including the zero-JS parent page. One confirmed Title Case violation (Reception's "Add Swimmer" `<h1>`) |
| Spacing | 8 | No horizontal overflow found at 375/390/430px on any tested screen |
| Buttons | 6 | The clearest, most concretely-evidenced system gap in the audit — see §7.2 |
| Cards | 7.5 | Consistent radius/shadow tokens; the dense-list-vs-row-card duality (§7.4) is a real, defensible pattern but undocumented as one |
| Forms | 6.5 | Excellent conditional logic (minor/guardian flow) undercut by two real defects: native date-input locale bug (§7.3) and a misordered submit button (Reception D1) |
| Icons | 8.5 | Lucide, individually imported, consistent stroke weight and soft-color containers across every role |
| Navigation | 7 | The four-item rule is respected everywhere via a consistent "quick-links grid for the fifth+ thing" pattern (Owner, Ops) — but one real active-state bug (Owner) and one real breakpoint bug (Ops desktop/mobile nav both rendering) |
| Modals | 7 | No modal overuse observed; inline substitution/sheets used appropriately where seen |
| Status/Badges | 5.5 | The single lowest score in this scorecard — a confirmed, three-role, computed-style-verified gap directly contradicting DESIGN.md's own opening thesis (§7.1) |
| Mobile Components | 8 | Register touch targets, sticky actions, bottom nav all solid; Ops's nav-duplication bug is the one real regression |
| Visual Hierarchy | 7 | Strong single-primary-action discipline in most places, undermined by Sessions (3 permanent buttons/row) and Vocabulary (8 simultaneous primary saves) |
| **Overall Consistency** | **7** | A real, shared design system clearly exists and is followed with discipline at the token level; it has not yet been systematized into shared components (Button, StatusBadge) that would make the remaining gaps structurally impossible |

---

## 7. Cross-cutting design-system findings

These are patterns that showed up independently in two or more roles — grouped per the audit's own instruction to report drift as a system-level problem, not a list of isolated diffs.

### 7.1 — Status/lifecycle fields outside the Members list are never color-coded (P1, systemic — Owner, Reception, Ops)
Confirmed by computed style in three independent places:
- Owner's `/owner/enquiries`: 4 sampled statuses (New/Contacted, twice each) all returned identical `color: rgb(60,83,79)`.
- Reception's `/reception/enquiries`: 5 sampled statuses, same identical color.
- Ops's `/ops/tenants`: "Active" and "Churned" tenants rendered with identical `background-color: rgb(237,240,236)` / `color: rgb(60,83,79)`.

The Members list (Active/Paused/Lapsed/Left) *does* correctly use good/warn/late/deck — proving the `StatusBadge` pattern exists and works. It simply never propagated to Enquiries (shared component across two roles) or to Ops's tenant status. This is the single most direct, measurable violation of `DESIGN.md`'s opening sentence: "Colour means money and attendance state. Nothing else" — the state exists, the color system exists, and the two aren't connected on three separate screens.
**Fix:** generalize the Members-list `StatusBadge` component and apply it to Enquiries (one shared component, two roles fixed at once) and to Ops's tenant status independently.

### 7.2 — No shared Button primitive; heights and treatment are one-off per call site (P2, systemic — Owner, Ops)
On a single Owner member-detail screen, five buttons sharing the same radius (14px) and border treatment measured five different heights: "Move to Paused/Lapsed/Left" 33px, "Enrol" 36px, "Get link" 38px, "Transfer" 44px, "Grant credit" 44px. Only the last two meet `DESIGN.md`'s hard 44×44px minimum — the other three are confirmed rule violations, not just inconsistencies. Independently, Vocabulary settings renders eight identically-emphasized full-width mango "Save" buttons on one screen with no dirty-state gating, directly diluting `DESIGN.md`'s "one primary action per screen" rule. Ops's "Mark churned" — a genuinely destructive, hard-to-reverse action — is styled as a plain neutral `ink-2` button with no `late`/red treatment and no visible confirm step.
**Fix:** a shared `Button` component with an enforced height scale (e.g. 40px default / 44px for primary or destructive actions), and a `destructive` variant that actually uses the `late` token.

### 7.3 — Native `<input type="date">` silently renders the wrong locale format on children's DOB fields (P1, data-integrity — Owner, Reception)
Both Owner's and Reception's "Add Swimmer" forms use a native date input with a `dd/mm/yyyy` placeholder that the browser ignores — confirmed rendering literal `mm/dd/yyyy` segment labels, and confirmed storing `05/20/2013` (month-first) for an intended 20 May 2013. Because this control is used for a minor's date of birth — a field the app itself uses to gate the guardian-consent flow (a genuinely well-built piece of logic, see §8.3) — a receptionist or owner typing a day ≤ 12 first will silently produce a wrong DOB with no error shown. `DESIGN.md`'s Holidays screen already proves the fix exists in the codebase: a custom masked `dd/mm/yyyy` text field, correctly rendered regardless of device locale.
**Fix:** replace the native date input with the same custom field pattern everywhere a swimmer's DOB or join date is collected — this is one component swap, not two separate fixes, since Owner and Reception likely share the same `AddMemberForm`.

### 7.4 — Two deliberate but undocumented list conventions coexist (P3, documentation gap, not a defect)
Long, dense lists (Members: 60+ rows, Enquiries) use a flat divided-list with no card, no radius, and a 1px `line`-token border-bottom — a reasonable choice that avoids over-cardifying dozens of rows (the audit's own §13 warns against this). Short, curated lists (Dashboard "Needs you today," Settings hub, Staff list) use the reference's full bordered/radius row-card. Both are internally consistent and well-executed; the gap is that this two-tier pattern isn't written down anywhere, so a future contributor has no way to know which one to reach for.
**Fix:** document the rule ("row-card for ≤10 curated items, divided-list for longer/dense lists") in `DESIGN.md` §3, rather than changing either implementation.

### 7.5 — Bottom-nav active-state and breakpoint bugs (P2, Owner + Ops)
Owner's "Home" nav tab stays lit (`color: rgb(184,78,0)`, the active/accent-ink color) on every quick-link destination (Enquiries, Programs, Staff, Onboarding) that isn't itself `/owner` — confirmed these are route *siblings* of Home, not children, so the active-match is a false positive. (Settings' own sub-pages correctly keep Settings lit, by contrast — the bug is specifically about siblings, not a blanket failure.) Separately, Ops at 1280×900 desktop renders **both** the full desktop sidebar and the mobile bottom bar simultaneously, overlapping content — reproduced on two different screens, indicating a missing responsive breakpoint class rather than a one-off.
**Fix:** Owner nav active-match should be exact-route or true-descendant only. Ops's bottom nav needs a `lg:hidden`-equivalent to stop rendering once the desktop sidebar takes over.

---

## 8. Detailed findings by role

Severity key: P0 = fix immediately, P1 = high impact, P2 = medium, P3 = polish, P4 = cosmetic.

### 8.1 Owner

| ID | Finding | Sev | Evidence |
| --- | --- | --- | --- |
| O-D1 | Nav "Home" stays active on sibling routes (Enquiries/Programs/Staff/Onboarding) | P2 | see §7.5 |
| O-D2 | Enquiries status has no color coding | P1 (elevated, see §7.1) | computed style, 4 samples identical |
| O-D3 | Button heights: 33/36/38/44px on one screen, three below the 44px hard minimum | P2 (elevated, see §7.2) | computed style |
| O-D4 | Reports "Enquiries funnel" shows unlabeled `1 → 0` cells | P3 | pre-existing, tracked in `role-surfaces-plan.md` §6, confirmed still present |
| O-D5 | "coach Coach Aanya Rao" duplicated label on Programs batch rows | P4 | UI's own "coach " prefix collides with a seed-data name that already starts with "Coach"; check against real (non-seed) names before treating as fully cosmetic |
| O-D6 | Native date input renders US format on DOB/Joined-on fields | P1 (elevated, see §7.3) | screenshot + programmatic value check |
| O-D7 | Sessions view: every row shows 3 full-width action buttons for a ~10,650px-tall unpaginated 14-day list | P2 | measured page height; inverts "what needs attention first" hierarchy |
| O-D8 | Vocabulary settings: 8 identically-emphasized primary Save buttons | P3 (contributes to §7.2) | visual + DOM count |
| O-D9 | One unreproduced routing hiccup on `/owner/settings/alerts` direct navigation | P4, unconfirmed | single occurrence, did not reproduce on retry |

**Good implementations:** Home hero (correct reuse of the money-hero shape for operational data since billing doesn't exist yet — genuinely good adaptation, not a gap), Settings hub (best row-card execution in the app), Member detail (the most complete, real "360" screen in the product — identity card, lifecycle actions, R.6 transfer, Wave-2 facility opt-in, R.7 makeup credits, live parent-link issuance, consent status, color-correct attendance history), Branding settings (states the accent/status-token separation rule back to the owner, correctly), Vocabulary settings (the best demonstration anywhere of architecture.md §7.5's closed-term-key system, multilingual, live preview), Add Swimmer's DPDP consent checkbox and minor/guardian dynamic logic, Holidays' correctly-formatted custom date field, Absence Alerts settings (explains its own noise-guard to the owner in plain language), Staff list (second independent confirmation of the row-card convention), and the confirmed, pixel-exact lane-strip on Home (§3).

### 8.2 Coach

| ID | Finding | Sev | Evidence |
| --- | --- | --- | --- |
| C-D1 | No bulk "Mark all present," no live "Late" marking option, no undo on the register | P2 | confirmed by using the real form; matches prior audit, re-verified fresh |
| C-D2 | Swimmer attendance history shows raw ISO dates (`2026-09-11`) | P2 (contributes to a broader date-format pattern also seen elsewhere) | DESIGN.md §4 violation |
| C-D3 | A 44%-attendance swimmer (above the alert-worthy threshold) shows no R.8 absence-alert line on her coach detail page | P3, **unconfirmed** | could be the daily 07:00 alert job simply not having run yet on freshly-reseeded data — needs a DB check on `absence_alerts`, not asserted as a UI bug |

**Good implementations:** the Register screen is the strongest single screen in the entire product — 44×44px Present/Absent buttons (the hard minimum, met exactly), correct late-soft/late tokens on a marked-absent state, optimistic no-spinner updates, a live "Saved at HH:MM" indicator, and a **reload test that confirmed a real mark actually persisted** with the swimmer's attendance percentage correctly recalculated. The lane-strip's dual correct semantics (warn on Schedule, water inside the register) is the best evidence in the audit that "one shape, many meanings" is real. The empty-roster register state is a textbook DESIGN.md empty state (verb CTA, explanation, no bare bar) — this directly refutes the prior audit's "empty progress bar looks broken" claim for this case. The Coach Members list correctly shows "(minor)" with proper accessible spacing (refuting a prior claim), and Coach Me's phone is correctly grouped (refuting another).

**Contextual:** Coach Members list still lacks attendance%/last-marked info (a legitimate scope question, not obviously a bug); Coach Me is sparse but makes no false promises (payroll isn't built yet); the coach's member detail is correctly, deliberately narrower than Owner's — the right shape for the role.

### 8.3 Reception

| ID | Finding | Sev | Evidence |
| --- | --- | --- | --- |
| R-D1 | Add Swimmer's submit button sits physically before the mandatory guardian/consent content (button top 711px vs. consent checkbox top 973px) | P1 | `getBoundingClientRect()`, confirmed twice |
| R-D2 | Enquiry status has no color coding | P1 (same defect as O-D2, see §7.1) | computed style, 5 samples identical |
| R-D3 | Native date input renders US mm/dd/yyyy (same bug as O-D6, confirmed on a second form) | P1 (see §7.3) | screenshot + programmatic value |
| R-D4 | Reception "Me" shows a mismatched name ("Coach Bhaskar Menon") for this login | environment artifact, not a live-product defect | traced to overlapping seed sources plus this session's one-column role_id correction — flagged as a caveat on this screenshot only |
| R-D5 | "Add Swimmer" page `<h1>` is Title Case | P3 | DESIGN.md "never Title Case" — narrowly the heading only; the submit button on the same screen ("Add swimmer") is correctly cased |
| R-D6 | "Add staff" role dropdown mixes casing (`coach` lowercase vs. `Receptionist`/`Worker`/`Accountant`) and uses a different control (select) than the sibling "Invite staff" form (two-button toggle) for the same decision | P3/P4 | visual inspection during the login-blocker investigation |

**Good implementations:** the minor/guardian dynamic form logic is genuinely excellent and correctly models DPDP consent (the checkbox copy itself changes to name the guardian as the consenting party) — a reference implementation for consent-sensitive forms elsewhere in the product. Enquiry quick-capture is a real, live-tested, sub-second interaction with no page reload — it satisfies the product's own "logged in fifteen seconds" promise from `how-it-works.html`. Phone formatting is now consistent throughout this role (refuting a prior claim), and sign-out is a one-tap, 47px-tall header button.

**Contextual:** Today shows one session card that is a genuine dead end (no link, no quick actions) with a lot of empty space below it — this matches an already-planned, not-yet-shipped improvement in `role-surfaces-plan.md` ("Add (now): quick actions on Today"), so it's a confirmed-outstanding roadmap item, not a new finding. No fee-collection UI anywhere — expected, Wave 3.

### 8.4 Parent

| ID | Finding | Sev | Evidence |
| --- | --- | --- | --- |
| P-D1 | The membership-runway lane-strip is not implemented on `/p/[token]` | P2 | see §3 — genuinely open, not a stale doc claim; reasonably blocked on Wave-3 billing data |
| P-D2 | Could not confirm whether the R.8 absence-alert line renders for a below-threshold swimmer | untested, not scored | the tested swimmer (78% attendance) correctly shows no alert; a below-threshold case wasn't available to test in this session |
| P-D3 | `/parent` (no token) now shows a styled but generic, non-parent-specific 404 ("Go to sign in"), and any truly unmatched route still shows a completely bare, unstyled 404 | P2 (downgraded from the prior audit's P0 — the bare-404 case is fixed) | screenshot evidence; `role-surfaces-plan.md` W1-3 asked for a parent-specific "ask your club for a link" explainer, which this is not, and there is still no app-wide branded 404 |

**Good implementations:** `/p/[token]` is confirmed genuinely zero client JavaScript (`document.querySelectorAll('script')` empty; only Next dev-server HMR polling appeared in network logs — won't exist in production), token-perfect inline HTML with no CSS-variable dependency (the correct choice for a JS-less route), the single most DESIGN.md-compliant date formatting anywhere in the app, DPDP-correct zero-tracking footer copy with a real fallback action, and correct tenant branding (fallback initials mark on the accent-soft color, per architecture.md §7.5's guarantee).

### 8.5 Platform/Ops

| ID | Finding | Sev | Evidence |
| --- | --- | --- | --- |
| X-D1 | Desktop (1280×900) renders both the sidebar nav and the mobile bottom nav simultaneously | P2 (see §7.5) | reproduced on two screens |
| X-D2 | Tenant status has no color coding | P1 (same defect family as O-D2/R-D2, see §7.1) | computed style, Active vs. Churned identical |
| X-D3 | "Mark churned" — a destructive, hard-to-reverse action — is styled as a plain neutral button with no visible confirm step | P2 (contributes to §7.2) | computed style: plain ink-2/white, no `late` token, not clicked to verify to avoid actually churning the demo tenant |
| X-D4 | Feature catalogue shows dozens of auto-generated e2e-test artifacts (`resolver-mtz0kvwd-expiring` etc.) mixed into the real feature list | P2 | screenshot evidence; worse than "opaque naming" — this is unremoved test pollution in a screen every operator sees |
| X-D5 | React hydration mismatch on the Ops login form (`method="POST"` server vs. `post` client) | P4, code hygiene | console warning, not user-visible |
| X-D6 | Tenant detail page is ~5450px tall at 375px width; the Owner-invite section (the one truly mutable action on this page) is buried below a 30+ row, test-polluted feature list | P2, confirmed and worsened since the prior audit | measured page height |

**Good implementations:** Ops Overview's card grid is a correct application of the "quick-links for the fifth+ thing" pattern — **the prior audit's own recommendation to add Activity to the bottom nav or a "More" sheet would have violated `DESIGN.md`'s explicit "no More tab, ever" rule**; the current implementation is already the right answer, and this report corrects that earlier recommendation. Desktop is a genuine, separate, well-considered layout (Marine sidebar, real data-table density) rather than a stretched mobile view, matching `DESIGN.md`'s explicit "Ops is desktop-first" directive. Sign-out is a persistent one-tap header action at every viewport — the best sign-out discoverability of any role tested.

**Re-verified against the prior audit, with corrections:** "No stats on Overview" — **confirmed still true**. "Override pill same orange as active button" — **does not reproduce**; computed style shows plain white/ink, correctly compliant with DESIGN.md's "`--accent` never in a status style" rule — retracted. "`/ops/plans/[planId]` dead link" — 404 confirmed, but no actual link to it was found anywhere in the current Ops UI, so it's unconfirmed whether it's reachable today.

---

## 9. UX quality notes (clarity / relevance / hierarchy / efficiency / feedback / trust)

- **Clarity & Confidence are highest on Coach Register and the Parent page** — both answer "what will happen if I act" before the user acts, and confirm afterward (live save timestamp; nothing to confirm on a read-only parent page).
- **Efficiency is weakest on Owner Sessions and Ops Tenant detail** — both require enormous, unprioritized scrolling to reach the one thing a user is actually there to do.
- **Trust is undermined in one specific, fixable way**: Ops's feature catalogue pollution (§8.5 X-D4) is the kind of thing an operator notices on day one and never fully un-notices — "if this list has fake stuff in it, what else does."
- **Recognition over recall** is strong throughout — every role's terminology, icon containers, and status language stayed legible without needing to remember a convention from another screen, with the one exception of the enquiry/tenant status gap (§7.1), where the *absence* of color forces re-reading text every time.

---

## 10. Top 10 design strengths

1. **Coach Register** (9.5/10) — reload-tested, real-time, offline-safe, exactly on-spec touch targets.
2. **The lane-strip component**, confirmed correctly reused with two different semantic meanings (Owner capacity via `warn`, Coach progress via `water`) — the reference's "one shape, many meanings" principle, actually built.
3. **Owner Member Detail** — the most complete, real, non-fake screen in the product (R.6/R.7 features, live parent-link issuance, correct consent/attendance display).
4. **Vocabulary settings** — best in-product demonstration of a genuinely hard architecture requirement (closed term-key system), explained to a non-technical owner in their own words.
5. **The zero-JS Parent page** — confirmed zero script tags, the most DESIGN.md-date-compliant surface in the app, correct privacy copy.
6. **Minor/guardian consent flow** (Reception's Add Swimmer form) — correct DPDP modelling without asking the user to think about it.
7. **Owner's quick-links-grid pattern**, correctly resolving the "need a 5th nav item" problem without breaking the hard four-item rule — and correctly mirrored by Ops's Overview cards.
8. **Branding settings** — states the accent/status-color separation rule back to the owner in-product, correctly.
9. **Absence-alerts settings** — explains its own noise-guard logic in plain language rather than hiding it.
10. **Terminology propagation** — "Swimmers" renders correctly and consistently across Owner and Coach surfaces, end to end, confirming architecture.md §7.5 actually works live.

---

## 11. Top 10 design/UX problems

| # | Problem | Roles affected | Screens | Severity | Why it matters | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Status/lifecycle fields outside Members are never color-coded | Owner, Reception, Ops | Enquiries (both), Tenant status | P1, systemic | Directly contradicts the product's own "colour means state" thesis; costs real scanning time on exactly the screens where urgency matters most | Generalize the Members `StatusBadge` component; apply everywhere |
| 2 | Native date input silently mis-stores DOB on children's records | Owner, Reception | Add Swimmer (both) | P1, data integrity | Silent, no error, on a DPDP-sensitive field the app itself gates a consent flow on | Swap to the already-proven custom masked field from Holidays |
| 3 | No shared Button primitive — heights/treatment are one-off | Owner, Ops | Member detail, Vocabulary, Tenant detail | P2, systemic | 3 of 5 sampled buttons on one screen violate the hard 44px rule; destructive actions aren't visually destructive | Shared Button component with an enforced size scale + destructive variant |
| 4 | Add Swimmer's submit button precedes required content | Reception | Add Swimmer | P1 | A CTA that appears to conclude the form actually can't, yet; genuinely confusing | Move the button (or make it a sticky footer) after all conditional content |
| 5 | Owner Sessions / Ops Tenant detail are unprioritized walls of content | Owner, Ops | Sessions, Tenant detail | P2 | Inverts "show what needs attention first"; ~10,000px+ scrolls measured | Default to Today/This week; collapse actions behind a single "Manage" tap |
| 6 | Ops feature catalogue is polluted with e2e-test artifacts | Ops | Feature catalogue | P2 | Erodes operator trust in the one screen meant to be a source of truth | Teardown step in e2e scripts, or filter test-status rows from the ops view |
| 7 | Nav active-state / breakpoint bugs | Owner, Ops | bottom nav (Owner siblings), Ops desktop | P2 | Users lose the one cue for "where am I" | Exact-route match for Owner; hide bottom nav at desktop breakpoint in Ops |
| 8 | `/parent` gives a generic, non-parent-specific 404; no app-wide branded 404 exists | Parent (and everyone, for the global case) | `/parent`, any unmatched route | P2 | A confused parent gets no hint they need a link, not a login; every other broken link in the app is completely bare | Parent-specific explainer per the existing plan; a global branded not-found page |
| 9 | 8 identical primary Save buttons on one screen | Owner | Vocabulary settings | P3 | Dilutes "one action per screen"; risks accidental no-op saves | Dirty-state gating per term |
| 10 | Prior P0s not retested this round (ZodError leak, Sessions UTC time) | Owner | Member detail (invalid id), Sessions | Unknown — treat as open | The most severe prior findings have no fresh evidence either way | Retest explicitly before assuming fixed |

---

## 12. Top 10 highest-impact improvements (not ranked by effort)

1. Ship a shared `StatusBadge` component and apply it to every lifecycle/stage field in the product (fixes finding #1 in one PR across three roles).
2. Replace every native DOB/date-of-birth `<input type="date">` with the existing custom masked field (fixes finding #2 across two roles with a component swap already proven in the codebase).
3. Build a shared `Button` primitive with an enforced height scale and a real destructive variant.
4. Retest and confirm/deny the two prior P0s (ZodError leak, Sessions UTC time) explicitly — don't let a fresh audit's silence be mistaken for "fixed."
5. Redesign Owner Sessions and Ops Tenant detail around "what needs attention today," collapsing exception-handling actions behind one control instead of three permanent buttons per row.
6. Fix the Reception Add-Swimmer button order — a one-file, high-confidence fix for a real, confusing defect.
7. Clean the Ops feature catalogue of e2e-test artifacts (or filter them from the operator-facing view).
8. Build the parent-specific `/parent` explainer already scoped in `role-surfaces-plan.md` W1-3, and add one genuinely global branded 404.
9. Fix the two nav bugs (Owner active-state, Ops desktop/mobile duplication) — both are small, targeted CSS/logic fixes with outsized "do I know where I am" impact.
10. Update `DESIGN.md`'s lane-strip claim (Owner and Coach reuses are shipped; only Parent's remains genuinely open) so the doc doesn't send the next contributor chasing an already-solved problem.

---

## 13. Final product judgment

| Question | Answer |
| --- | --- |
| Does the application visually match `sports-club-ui-direction.html`? | **Mostly** — token/shape fidelity is very strong; the bottom nav is a flush bar rather than the reference's floating rounded pill, and the lane-strip is 2/3 reused (not 3/3) |
| Does it feel like one coherent product? | **Mostly** — the same design system is demonstrably shared across all 5 tested surfaces, including the zero-JS parent page, which is the hardest place to keep a system consistent |
| Does it feel like Aqua rather than a generic SaaS/admin app? | **Mostly** — Settings/Vocabulary/Register/Member-detail/Parent-page are genuinely distinctive; Sessions and the Ops feature catalogue feel like generic admin tooling |
| Does the UI communicate the sports-club operating-system intent? | **Mostly** — real operational data (registers, attendance, enrolment) stands in convincingly for the money data that isn't built yet |
| Are role-specific experiences genuinely different where they should be? | **Yes** — separate route groups, visibly different scope per role (coach's member detail is deliberately narrower than owner's; ground staff has no surface at all rather than a fake one) |
| Is the mobile experience production-ready? | **Mostly** — zero overflow found at any tested breakpoint; the remaining gaps are touch-target/hierarchy/nav-state issues, not layout breakage |
| Is the design-system implementation mature? | **Partially** — token discipline is mature and enforced; component-level consistency (Button, StatusBadge) has not yet been systematized, which is exactly why the same two defects (uncolored status, inconsistent button height) surface independently in 3+ places each |

---

## 14. Final scores

**Overall UI/UX:** 7.6/10
**Design Direction Compliance:** 8.0/10
**Design-System Consistency:** 6.5/10
**Mobile Experience:** 7.5/10
**Product Intent Alignment:** 8.0/10
**Role Experience:** 7.8/10
**Overall Product Design Maturity:** 7.5/10

**Classification: Strong Production UI.** Not yet "Polished" — that tier would require a shared Button/StatusBadge component system eliminating the repeated, independently-discovered inconsistencies documented above, plus the money-centric screens the reference itself leads with. Comfortably past "Functional MVP" — the core workflows (attendance marking, member management, parent communication) are trustworthy, real-time, and reload-tested, not just visually plausible.

---

## 15. Executive summary (closing)

**What Aqua is doing right:**
1. Token discipline is genuinely enforced, not just documented — verified via computed style dozens of times across 5 roles with no arbitrary colors found.
2. The lane-strip's dual-semantic reuse (Owner/Coach) is real evidence of systemic design thinking, not a lucky visual coincidence.
3. The coach register is reload-tested and trustworthy — the exact workflow the product's philosophy is built around.
4. The zero-JS parent page fully honors its own constraint while staying visually on-brand.
5. Role-appropriate scoping is real: coach's member detail, ground staff's total absence, and reception's narrow toolset all reflect actual job shape, not a shared dashboard with hidden buttons.
6. Consent/DPDP modelling (minor/guardian flow) is handled correctly and quietly, without extra user burden.

**Where Aqua is currently weak:**
1. No shared Button or StatusBadge component — the same two defect classes recur independently in 3+ places each.
2. Two native-date-input bugs create silent data-integrity risk on children's records.
3. Owner Sessions and Ops Tenant detail invert the product's own "attention first" hierarchy principle.
4. Ops's feature catalogue carries visible test debris into a trust-critical operator screen.
5. Two nav bugs (Owner active-state, Ops breakpoint duplication) undermine "do I know where I am."

**Biggest design-system problems:** status-badge coverage gap; button-height/hierarchy gap; undocumented (though defensible) dense-list-vs-row-card duality.

**Biggest UX problems:** unprioritized long screens (Sessions, Tenant detail); a submit button that precedes required fields; eight competing primary actions on one settings screen.

**Biggest mobile problems:** Ops's desktop/mobile nav duplication; a handful of sub-44px buttons — notably, zero layout-overflow issues were found at any tested breakpoint, which is a genuine mobile-first success.

**Biggest product-intent problems:** `/parent`'s 404 doesn't know it's talking to a parent; the reference's money-centric hero pattern can't yet be judged anywhere because billing doesn't exist — not a defect, but the single biggest gap between the reference's ambition and today's build.

**Highest-impact changes (top 5):** (1) shared StatusBadge across Enquiries/Tenant status, (2) fix the native-date-input bug on both forms that use it, (3) shared Button primitive with a real destructive variant, (4) retest the two un-retested prior P0s, (5) rebuild Sessions/Tenant-detail around "today first."
