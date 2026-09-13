# Aqua — Indian User Psychology & Role-Based UX Audit

**Date:** 2026-09-13
**Auditor:** UX researcher / product designer / Indian consumer UX specialist (via Playwright, live browser testing against a running `next dev` instance — not source-reading alone, though source was read to confirm root causes)
**Supersedes nothing — companion to** `docs/audits/2026-09-13-ui-ux-audit.md` (the visual/design-system audit, already implemented per commits `62c15c9` and `0d23369`). This audit deliberately does not re-litigate that audit's pixel/token findings. Where this audit re-touches a screen that audit covered, it either (a) confirms the fix with fresh evidence, or (b) reports a genuinely new problem the first audit didn't surface. Every such case is labelled.
**Roles tested live:** Owner, Coach, Receptionist, Parent (`/p/[token]`), Platform/Ops. Ground Staff and Accountant remain unbuilt (no route group exists) — confirmed still true, not re-argued.
**Tenant:** Aqua Worli Aquatic Club (`demo-academy`), swimming preset, terminology override active (member → "Swimmer"). Viewports: 390×844 for all frontline roles, 1280×900 for Ops.

---

## 0. Environment notes — read before the findings

The DB was **not** reset (existing seed data seen by the previous audit was reused; `pnpm demo:reset` was attempted and correctly blocked by the session's safety classifier as a destructive action outside this audit's scope — the user confirmed the DB already had the standard seed and only a platform-operator account needed adding, which was done with explicit user approval via `seed-platform-user.ts`, an additive script).

Three classes of **transient artifact** were hit and excluded from findings after confirming non-reproducibility on a fresh reload, matching the previous audit's own methodology (§0 of that report excluded a first-load webpack race for the same reason):

1. A stale `.next` build (present before this session started) produced one hydration-mismatch console error on `/owner/members` showing an *old* status-badge markup on the server render. Cleared with `rm -rf .next` + restart; did not reproduce on any subsequent screen.
2. After that mid-session restart, one already-open tab briefly referenced a stale Server Action ID and rendered a raw "Server Action ... was not found on the server" error box on a member-detail page. Did not reproduce on reload — this is a `next dev` restart artifact, not a shippable bug.
3. **Next.js dev-only first-compile races**, reproduced three separate times (`/owner/members/new`, `/reception/members/new` twice): the *very first* hit to a not-yet-compiled route occasionally serves a hydration mismatch where the initial HTML contains an **old native `<input type="date">`** while the client immediately replaces it with the current masked `DateField` component. Confirmed via direct DOM inspection that the live source (`components/ui/DateField.tsx`, `components/member-create-form.tsx`) contains no native date input anywhere — grepped the full tree. Every one of these resolved cleanly on the second load of the same route. `docs/demo-runbook.md` itself documents this class of issue ("`next dev` compiles each route on its first visit... warm up the platform login before he sits down"). **Excluded from findings below.** Flagged here because it cost real investigation time and a future auditor should not re-discover it as new.

Everything reported below reproduced on a clean, already-compiled route.

---

## 1. Executive summary

The previous audit measured whether Aqua *looks* and *behaves* like a coherent design system. This audit asked the harder question: would this actually work for the people who run and use a real Indian swimming club? The answer is **mostly yes, with one front-door defect that would silently lock out most real users on day one**, a handful of genuine (if narrower) regressions introduced by yesterday's own fixes, and a set of structural gaps between the product's stated philosophy (`docs/how-it-works.html`) and what's actually shippable today — gaps that are legitimate roadmap sequencing, not bugs, but which this audit is explicitly asked to surface because they change whether the product *feels* like the thing it promises to be.

**The single most important finding in this report:** the phone + PIN login (`components/login-form.tsx`, `lib/services/credentials.ts`) silently rejects the single most natural way an Indian user types their own mobile number. A person who types their number the way they say it out loud — `9000000001`, ten digits, no country code — gets a generic "Wrong number or PIN" error, indistinguishable from actually having forgotten their PIN. Only a number typed with an explicit `+91` prefix succeeds. This is not a training problem or an edge case; it is the default behavior of the one input every single user of this product, in every role, must get right before they can do anything else. See Finding **F-1**.

Set against that, several of yesterday's fixes are confirmed working well under fresh, reproducible testing: the coach register's bulk "Mark all N present" and the "Late" marking state (both previously flagged as missing) now exist; the native-date-input bug on children's DOB fields is genuinely fixed with a well-built masked `dd/mm/yyyy` field; Reception's Add Swimmer form now places its submit button after all required content; the Ops tenant-status color-coding and "Mark churned" destructive-styling-plus-mandatory-reason fixes are both live and, in the churn case, better than the minimum the previous audit asked for; and the Ops feature catalogue's e2e-test pollution is gone. These are cited as strengths with fresh evidence, not carried forward from the prior report.

New problems this audit found that the visual audit's methodology wasn't positioned to catch: the zero-JS parent page hardcodes the word "Member" and never touches the tenant's own terminology system, so a swimming club's parents — the highest-trust, most literally "handed a link" audience in the product — see generic SaaS vocabulary while the club's own staff see "Swimmer" everywhere else. The Owner home screen's hero card ("Today's registers: Nothing scheduled today") directly contradicts the "Today's lanes" section three inches below it on the same screen, which lists a real session happening that day. And the "neutral" status tone introduced by yesterday's `StatusBadge` fix is invisible on Enquiries — its background color is identical to the page background it sits on, so "Contacted" enquiries render as floating text with no visible container, which is a fresh regression from the fix meant to solve exactly this class of problem.

At the product-philosophy level: `how-it-works.html` sells a WhatsApp-first, automatic-reminder, zero-phone-call operating system. Today's build has no messaging provider wired up anywhere — not a bug, Phase 2/3 sequencing per `docs/architecture.md` §19, but it means "Absence alerts" (a real, honestly-built feature) only ever reaches a parent if they happen to already have an open `/p/[token]` link in hand, because there is no push channel to *tell* them to look. The gap between the promise and the build is honestly represented in the UI (no fake WhatsApp buttons, no invented payment tiles) — but it is the single largest determinant of whether a real club would feel the product is "done" versus "a demo."

---

## 2. Role-by-role: job, context, psychology

### 2.1 Owner

**Job:** Knows the business is healthy without doing bookkeeping. Checks in between other things — reception counter, on the pool deck, in the car.
**Context:** Phone, standing or walking, 30–90 second glances several times a day; occasionally sits down with the laptop for settings/reports.
**Frequency:** Home screen — multiple times daily. Enquiries follow-up — daily. Settings/vocabulary/branding — once, at setup, then almost never. Reports — weekly at most.
**Goals:** "What needs my attention right now" and "am I losing money or members without knowing it."
**Information needs immediately:** overdue follow-ups, today's batches, anything broken (uncovered batch, missed chlorine check — the last one doesn't exist yet since facilities aren't built). Can wait: historical trends, settings.
**Stress points:** A contradiction between two numbers on the same screen (see F-2) is exactly the kind of thing that erodes an owner's trust in a system they're being asked to replace a paper register with — if the dashboard can't agree with itself in the same viewport, why would they trust it about money once billing ships?
**Psychology:** Owners in this segment have been burned by software that promises automation and requires more manual work than the notebook it replaced. Every honest empty state ("Nothing scheduled today" — when actually true) builds trust; every screen that overclaims or contradicts itself spends it.
**Success:** Owner opens the app once in the morning, understands the day, taps through to the one thing that needs a decision, and closes the app. No screen requires interpretation.

**Fresh evidence, Owner home (`/owner`):**
- "Needs you today" correctly surfaces three genuinely overdue follow-ups with names, days-overdue, and one-line context — this is the "what should I do next" pattern the audit brief asks for, done right.
- The stat row (Active swimmers / Attendance this week / Batches running) is honest — no money tile, matching the explicit "no placeholders for absent data" rule in `docs/implementation-plan.md` S4.
- **F-2 (new):** "Today's registers" hero says "Nothing scheduled today." The very next section, "Today's lanes," lists "9:00 am Sunday Open Practice, 0/12" — a session that day. These two claims contradict each other in the same 10-second glance the whole screen is designed around. Root cause (inferred, not confirmed against source): "registers" likely counts sessions that have *started* being marked, while "lanes" shows the day's full schedule regardless of marking state — a legitimate distinction internally, but the copy doesn't communicate it, so a first-time owner reads it as a bug in the software before they've had their coffee.

### 2.2 Coach

**Job:** Turn up, know who's in the water, mark it, get back to coaching. Nothing else matters at 6:45 AM poolside.
**Context:** Phone, standing, often wet hands, outdoor light, between 5 and 40 minutes before/during a session.
**Frequency:** Register — every session, every day. Schedule — glanced at start of shift. Members/Me — rarely.
**Goals:** Mark 12–16 kids correctly in well under a minute, know it saved, move on.
**Stress points:** Ambiguity about whether a tap registered; having to hunt for a name in a long list; a workflow that requires two hands or careful aim in bright sun.
**Psychology:** This is the one role where the product's credibility is decided in the first 30 seconds of first use. A coach who loses a register once stops trusting the app for the rest of the season (this is stated almost verbatim in `docs/architecture.md` §12: "A coach who loses a register to a dropped connection stops trusting the product that day").
**Success:** Full register marked, visible "Saved at HH:MM," coach never thought about the software as software.

**Fresh evidence, corrects/updates the previous audit's C-D1 finding:**
- **Confirmed fixed / previously reported as missing:** a genuine bulk "Mark all N present" button exists and correctly re-labels itself to the *remaining unmarked count* (tested: showed "Mark all 12 present" on a fully empty register, "Mark all 10 present" after marking 2). The previous audit's C-D1 ("No bulk 'Mark all present'") no longer holds — this should be corrected in the design-system audit's living record.
- **Confirmed fixed:** a third "Late" state now sits between Present and Absent (also previously flagged missing in C-D1). All three controls measured **44×44px exactly** — the hard minimum, met precisely, not just "close enough."
- **Confirmed working, reload-tested fresh:** marked Present/Absent on two students, reloaded the page cold — both marks persisted, header correctly read "2 of 12 marked · Saved at 01:21 pm" before and after reload.
- **Psychology note on the bulk action (new observation, not a defect):** "Mark all present" is a genuine efficiency win for the common case (most kids show up most days), but it is also the one control on this screen that could let a rushed coach mark an entire class present without looking at a single face — the opposite of what the register exists to guarantee. This is a reasonable trade-off (the individual toggles remain one tap away to correct), not a recommendation to remove it, but worth naming: efficiency and per-child accuracy are in tension here, and the UI currently resolves it entirely in favor of efficiency.
- **Coach "Me" page** is still a two-line stub (name, phone, sign out) with a large empty area below. Per `how-it-works.html`'s own vision ("Checks herself in at the start of the shift," "Sees her own payslip, nobody else's"), this is where a coach would expect to see her own attendance/check-in state and eventually pay — none of that exists yet (Phase 3, not started). Not a bug; flagged because the empty space directly under "Me" is the most visible reminder in the whole coach surface of how much of the original pitch isn't built yet.

### 2.3 Receptionist / Front Desk

**Job:** Handle a parent standing at the counter, mid-conversation, without going silent to fight the software.
**Context:** Shared desktop or tablet, noisy room, conversations that can't pause for a slow screen.
**Frequency:** Search/add member, log enquiry — many times a day. Everything else — rare.
**Goals:** Find the right person in seconds, from partial information (a name fragment, last 4–5 digits of a phone).
**Stress points:** A form that seems finished but isn't (submit button appearing before required fields — this was P-D1 in the last audit); ambiguous status text; anything that requires a second screen mid-conversation.
**Psychology:** The receptionist is the one role explicitly required to multitask with a live human in front of them. Every extra tap or moment of on-screen ambiguity is a moment of dead air with a parent watching.
**Success:** Parent's name typed, correct record found, task done, parent still feels attended to throughout.

**Fresh evidence:**
- **Search genuinely works well** for the receptionist's actual job: typing the last 5 digits of a phone number (`40021`) instantly filtered to the one matching swimmer; typing a shared prefix (`98123`) correctly returned all 40 matches. This is exactly the "find someone from limited information" pattern the brief calls out, and it's client-debounced with no visible lag.
- **Confirmed fixed, previously R-D1 (P1):** the Add Swimmer submit button now sits after the guardian/consent block in document order, not before it. Tested by entering a minor's DOB (`20/05/2018`) and confirming the "Guardian required" section and consent checkbox render above the "Add swimmer" button, with an inline "Consent is required before saving" message directly above the CTA.
- **Confirmed fixed, previously O-D6/R-D3 (P1, data integrity):** the DOB field is the new masked `DateField` (`components/ui/DateField.tsx`) everywhere it appears (Owner and Reception both use the shared `MemberCreateForm`). Typed `20052018` and it correctly rendered `20/05/2018` — day-first, no silent US-locale swap. This is a well-built fix: it validates real calendar dates (rejects `31/02/...`), shows an inline error rather than silently storing garbage, and accepts a pasted ISO string without misreading it as day-first digits.
- Reception's "Today" screen remains a single session card with no quick actions and a lot of empty space below it (confirmed still true, matches the prior audit's contextual note that this is already scoped in `role-surfaces-plan.md`, not a new finding).

### 2.4 Parent

**Job:** Understand, at a glance, that their child is fine — showed up, is progressing, nothing owed (once billing exists).
**Context:** A WhatsApp link opened on a phone, cold — no account, no app, no memory of ever configuring anything.
**Frequency:** Occasional — whenever a link is sent or they think to check.
**Goals:** Confirm the thing they're anxious about (did my kid actually show up / is this the right kid / is everything fine) in under five seconds.
**Stress points:** Any vocabulary mismatch between what the club calls their child's activity and what the page says; any sense that this link might be shared with or trackable by someone else; not knowing whether the link still works next week.
**Psychology:** Parents in this segment are highly attuned to DPDP/child-data-privacy framing (India's children's-data law is a live, discussed topic in Indian parent WhatsApp groups) — the zero-tracking, zero-JS, "anyone with the URL can view until [date]" framing is exactly the right register of honesty for this audience.
**Success:** Parent opens the link, understands it immediately, feels the club is organized and trustworthy, closes the tab.

**Fresh evidence, and this section's headline finding:**
- Confirmed genuinely zero client JavaScript (`document.querySelectorAll('script').length === 0`), token-correct, dates in the product's own `22 Aug` convention, correct present/absent color coding on the attendance history, and a real, honest expiry statement ("Valid until 20 Sept 2026, 01:19 pm. Anyone with the URL can view the page until then.").
- **F-3 (new): the parent page never touches the tenant's terminology system.** This tenant's vocabulary override renders "Member" → "Swimmer" everywhere on the Owner and Coach surfaces (confirmed: Owner's member-detail header literally says "SWIMMER"). The `/p/[token]` route (`app/p/[token]/route.ts:216` and `:222`) hardcodes the literal strings `"Member view"` and `"Member"` directly into the HTML string it returns — there is no `resolveTerm()` call, no terminology parameter, nothing. A parent at a swimming club whose staff have consistently said "swimmer" to them opens the one link the club sends them and sees "MEMBER VIEW" and "Aarav Sharma / MEMBER." This is architecturally explainable — the route is a raw `Response`-returning Route Handler specifically so it ships zero client JS (per `docs/architecture.md` §11.3), and whoever built it evidently didn't wire the terminology resolver into that separate code path — but the result is that the one feature the previous audit called "the best in-product demonstration" of vocabulary consistency (§10.4 of that report) has a silent, total blind spot on the single most customer-facing surface in the product.
- The membership-runway lane-strip remains unbuilt on this page (confirmed still true, correctly attributed to Wave 3 billing not existing yet — not re-argued as new).

### 2.5 Ops / Platform Administration

**Job:** Manage every tenant on the platform: onboard, configure, watch for trouble, act on it. Desktop-first by design, evaluated as such.
**Context:** A desk, a large screen, mouse and keyboard, a queue of tenants to process.
**Frequency:** Tenant management — daily for an active platform. Feature catalogue, presets — occasional/setup-time.
**Goals:** Scan tenant health fast, act on the ones that need it, trust that the data on screen is real.
**Stress points:** Test/seed pollution in an operator-facing list (undermines "if this is fake, what else is"); an irreversible action with insufficient friction.
**Psychology:** Ops staff are the most technically literate audience in the product and the least tolerant of a screen that lies to them, even by omission.
**Success:** Operator can find any tenant, understand its state, and safely perform a status change with a clear, logged reason.

**Fresh evidence — several confirmed fixes, one confirmed regression-adjacent gap:**
- **Confirmed fixed, previously X-D2:** Tenants list now correctly color-codes status — "Active" renders in `good` green, "Churned" in neutral gray, via the shared `StatusBadge`/`TENANT_STATUS_TONE` mapping.
- **Confirmed fixed and exceeded, previously X-D3:** "Mark churned" is now the `destructive` (red/`late`-token) button variant, and clicking it (verified by reading `status-transitions.tsx` rather than firing it against the real demo tenant, matching the previous audit's own caution) opens a modal that requires a typed reason, states the consequence in plain language ("Marking churned terminates the tenant. Members cannot sign in after this. The transition cannot be undone."), and separately offers Cancel. This is better than the minimum fix the prior audit asked for and is cited as a strength.
- **Confirmed fixed, previously X-D4:** the Feature catalogue (12 features across 8 categories, scrolled to the bottom) is completely clean of the previously-reported e2e-test artifacts (`resolver-mtz0kvwd-expiring` etc.).
- **Confirmed improved, previously X-D6:** Tenant detail at 1280×900 is 1,861px tall with status/settings/stats/owner sections in a sensible top-to-bottom order — a dramatic improvement from the previous audit's 5,450px-at-375px measurement (that number was taken at a mobile width the surface isn't designed for; at its actual native desktop width the page is reasonably scannable).
- **F-4 (new, partial-fix residual):** the Tenants list itself still carries visible test pollution — three rows named "Wave2 Joined" (`wave2-joined-mtyx0b3d` etc.), auto-generated by a feature-test script, sitting in the live operator-facing tenant list next to the two real demo tenants. The exact class of problem the previous audit flagged in the Feature catalogue (X-D4, now fixed) reappears one level up, in the Tenants list, which nothing in this codebase currently distinguishes from real customer tenants (no "test" flag, no archive/hide filter). This is a real operational hygiene gap: any e2e script that provisions a tenant against a shared, non-ephemeral database — which is exactly the situation this session found — leaves permanent, indistinguishable clutter in the one list an operator relies on being ground truth.
- **F-5 (new, minor):** the "Demo data — this is a demo tenant" banner renders on every Ops screen, including the login page, even though Ops has no single-tenant context at all — it manages every tenant on the platform. The copy is simply wrong on this surface (there is no "this" tenant to refer to).
- Ops Overview still shows zero live stats below its four navigation cards (confirmed still true, not re-argued) — a large blank area on the one screen that should answer "is anything on fire right now" for an operator opening the control plane cold.

---

## 3. Product-philosophy gap analysis (Indian market framing)

`docs/how-it-works.html` — the canonical statement of what this product is *for* — leads with WhatsApp reminders, one-tap UPI payment, automatic dunning, and payroll. `docs/demo-runbook.md`'s own "What is NOT built" section is admirably honest that none of billing, messaging, payroll, or facilities exist yet; this is Phase 2/3 sequencing (`docs/architecture.md` §19), not an oversight, and the UI does not fake any of it — no phantom "Send WhatsApp reminder" button that does nothing, no invented revenue chart. That restraint is itself a strength worth naming (see §7).

But the audit's mandate is to judge whether the product *feels* like the thing it claims to be, not only whether each screen is individually honest. Two concrete consequences of the messaging gap:

- **Absence alerts have no delivery mechanism.** The feature is real and well-explained to the owner ("Coaches see a read-only alert on a member's profile, and the parent link carries one line... Needs at least 4 marked sessions this month, so a single miss never alerts"). But nothing *pushes* this to anyone. A coach only sees it if she opens that specific member's profile unprompted; a parent only sees it if they already have an unexpired `/p/[token]` link open and choose to look. Compare this to `how-it-works.html`'s own framing: "if it had been missed, the owner would have seen it flagged" — flagged *where*, proactively, is the part that doesn't exist yet. For the exact use case this feature is meant to solve (catch a quietly-disengaging kid before the family just stops showing up), a passive, un-pushed alert is close to invisible in practice.
- **Indian users' calibrated trust in "read receipts" and delivery confirmation** (from UPI apps, WhatsApp Business, banking SMS — the reference points the brief asks to consider) has no analogue anywhere in Aqua yet, because there is no send-and-confirm flow to build that trust language around. This isn't a defect to fix today; it is the single largest determinant of whether the *next* audit, once messaging ships, needs to specifically check for "sent," "delivered," "read" style status language — Indian users will expect it by default, having learned it from WhatsApp itself.

On the parts of the Indian-market brief that *are* testable today:
- **Phone-number-first identity** is the right default (no email requirement anywhere in the staff-facing flows), consistent with Indian SMB software norms — undermined only by F-1's normalization bug.
- **Cash-first payment framing** cannot yet be evaluated — no payment UI exists.
- **Search by partial phone digits**, the dominant Indian retail/reception pattern, works correctly today (§2.3).
- **Cyclic dd/mm/yyyy date formatting**, the correct Indian convention, is now consistently and correctly enforced via the shared `DateField`, closing what was a real, confirmed data-integrity risk on children's records in the last audit.

---

## 4. Findings

Each finding follows the requested format. Findings are ordered by severity within role groupings; F-1 is cross-cutting and affects every role identically.

### F-1 — Phone-number login silently rejects the standard way Indians type their own number

**Severity:** Critical (P0)
**Role:** Every role (Owner, Coach, Reception, Ops-adjacent — tenant staff login specifically; Ops itself uses email/TOTP so is unaffected)
**Screen:** `/login`
**Problem:** Typing a bare 10-digit mobile number (e.g. `9000000001`) with a correct PIN fails with a generic "Wrong number or PIN" error. Typing the same number with an explicit `+91` prefix succeeds.
**Evidence:** Live-tested both paths against the same seeded credential (`+919000000001` / PIN `123456`). Bare 10-digit: `POST /api/login/pin` → 401, UI shows "Wrong number or PIN. Try again, or ask your club for a login link." Prefixed: same credential, 200, redirects to `/owner`. Root cause read directly from source: `components/login-form.tsx:27-29`'s `normalise()` only strips whitespace/hyphens — it never adds a country code. `lib/services/credentials.ts:210` then does `rawPhone.replace(/[\s\-()]/g, "").replace(/^0/, "+91")` — this handles only a **leading `0`** (the old Indian trunk-prefix landline convention), not a bare 10-digit mobile number, which is how virtually every Indian gives out and types their own mobile number. The placeholder text (`+91 98765 43210`) is the *only* hint that a country code is expected, and it is easy to read as an example format rather than a literal requirement, especially for a first-time, non-technical user.
**Why it matters:** This is the front door. Every single person who will ever use this product — owner, coach, receptionist — authenticates through this one form. A wrong-PIN error and a wrong-format error are indistinguishable to the user, so a person who typed their number correctly (by their own standard) has no way to self-diagnose; the error message actively suggests the wrong fix ("ask your club for a login link") for what is actually a formatting bug, not a forgotten credential. Combined with the 5-failed-attempts lockout (`lib/services/pin-lockout.ts`, 15-minute lock), a user who retries their own correct number a few times in slightly different ways (with spaces, without spaces, with `91` but no `+`) could lock themselves out entirely without ever having gotten the PIN wrong.
**Recommendation:** Fix the normalization to treat any bare 10-digit string starting with `6`–`9` (the valid Indian mobile prefix range) as an implicit `+91` number, in addition to the existing leading-`0` handling — this single change in `lib/services/credentials.ts`'s `pinLogin` (and ideally mirrored in `components/login-form.tsx`'s client-side `normalise()` so the behavior is visible before the network round-trip) fixes the default case. Consider also formatting-as-you-type (auto-inserting `+91` once 10 digits are entered) so the field visibly shows what will be submitted, the way most Indian OTP-login flows already do.
**Classification:** Bug

### F-2 — Owner home's two "today" sections contradict each other

**Severity:** High (P1)
**Role:** Owner
**Screen:** `/owner` (home)
**Problem:** The hero card states "Today's registers: Nothing scheduled today." The section directly below it, "Today's lanes," lists a real session for that same day ("9:00 am Sunday Open Practice," 0/12).
**Evidence:** Screenshot captured live; both strings visible in the same viewport without scrolling on a 390px-wide screen.
**Why it matters:** The owner home screen exists specifically to answer "what is my day" in ten seconds. Two adjacent, contradictory claims about "today" on the one screen designed for a fast trust-building glance is the fastest possible way to make a new owner doubt the software rather than the register it's replacing.
**Recommendation:** Either make the two sections agree (if "registers" genuinely means "sessions marked so far today," relabel it to say that explicitly — "0 registers taken today" rather than "Nothing scheduled today"), or, if "nothing scheduled" is a genuine bug in how the hero queries today's sessions, fix the query. Do not ship a screen where two headline numbers about the same day can disagree.
**Classification:** UX problem / possible bug (root cause not confirmed against source in the time available — recommend a developer check the query behind the "Today's registers" hero against the one behind "Today's lanes").

### F-3 — Parent page never applies tenant terminology

**Severity:** High (P1)
**Role:** Parent
**Screen:** `/p/[token]`
**Problem:** The zero-JS parent page hardcodes the literal word "Member" ("MEMBER VIEW" eyebrow, "MEMBER" label above the child's name) regardless of the tenant's configured vocabulary. This tenant's vocabulary override renders "member" as "Swimmer" everywhere else in the product.
**Evidence:** `app/p/[token]/route.ts:216` and `:222` — both are literal string constants baked into the returned HTML, with no call to the terminology resolver (`resolveTerm()`, used correctly on every other tenant-facing surface per `docs/architecture.md` §7.5). Confirmed live: Owner's member-detail page for the same swimmer shows "SWIMMER" in the identical UI position; the parent link generated from that same page for that same swimmer shows "MEMBER."
**Why it matters:** This is architecturally the hardest surface to keep consistent (a separate, zero-client-JS Route Handler, not the shared React component tree) and also the single most customer-facing one — it is the literal artifact a club hands to a paying parent. The previous audit specifically praised terminology propagation as "the best in-product demonstration... confirming architecture.md §7.5 actually works live"; this finding shows that claim has a total, silent blind spot on exactly the surface where a vocabulary mismatch is most visible to the person the club least wants confused.
**Recommendation:** Thread the resolved terminology strings (not the full resolver — this route deliberately ships no client JS or dynamic logic beyond string interpolation) into the two hardcoded labels in `app/p/[token]/route.ts`. The tenant's terminology state is already being fetched server-side for other parts of the parent-view data; only the label strings need to change from literals to resolved values.
**Classification:** Functional gap / design-system problem

### F-4 — "Neutral" status tone is invisible against the page background

**Severity:** Medium (P1, regression from yesterday's fix)
**Role:** Owner, Reception (shared `EnquiriesBoard` component)
**Screen:** `/owner/enquiries`, `/reception/enquiries`
**Problem:** The `neutral` `StatusBadge` tone (`bg-deck text-ink-2`, used for the "Contacted" enquiry stage) renders with a background color identical to the page's own background, so the pill is functionally invisible — "Contacted" appears as bare floating text with no visible container, while "New" (the `warn` tone) correctly shows as a solid orange pill on the same list.
**Evidence:** Computed style, verified directly: badge background `rgb(237, 240, 236)` (`#EDF0EC`) equals the page/list background (both are the `--deck` token); screenshot confirms the visual effect.
**Why it matters:** This is a fresh side-effect of the exact fix the previous audit asked for (§7.1 of that report: "Status/lifecycle fields outside Members are never color-coded"). The fix correctly generalized a shared `StatusBadge` component, but the `neutral` tone was designed against a white-card context (where `bg-deck` reads as a visible light-gray pill) and doesn't hold up on the flat divided-list convention this screen actually uses, where the list itself sits directly on the deck-colored page background. The result: the very state ("Contacted") that most needs a legible, scannable badge — since it's the largest bucket of ongoing enquiries — is the one that's hardest to see.
**Recommendation:** Give the `neutral` tone a background that contrasts with both white cards and the deck page background — e.g. a light `ink`-tinted fill with a hairline border, or simply reuse `bg-paper` with a `border border-line` regardless of surrounding context. This is a one-line change in `components/ui/StatusBadge.tsx`'s `TONE_CLASS.neutral`.
**Classification:** Bug (contrast/visibility regression)

### F-5 — Absence alerts have no proactive delivery channel

**Severity:** Medium (P2 — product decision, sequencing-correct, but worth surfacing)
**Role:** Owner, Coach, Parent
**Screen:** `/owner/settings/alerts`, coach member-detail, `/p/[token]`
**Problem:** The absence-alert feature is honestly built and honestly described ("Coaches see a read-only alert on a member's profile, and the parent link carries one line"), but nothing pushes it to anyone — it is only visible to a coach who opens that specific profile, or a parent who already has an open link.
**Evidence:** Settings copy read directly from `/owner/settings/alerts`; confirmed no messaging provider exists in the codebase per `docs/demo-runbook.md`'s own "what's not built" list.
**Why it matters:** This is the feature `how-it-works.html` sells as the emotional core of the product ("catch it before the family just stops showing up"), and today it functions closer to a note left in a drawer than an alert. Not a bug — Phase 2/3 sequencing is a legitimate call — but worth flagging because it's the clearest single example of the gap between the product's marketing narrative and its current build, and it will shape how "absence alerts" should be re-evaluated once WhatsApp lands (at that point, this becomes a real P1: does the push message actually fire, and does it show delivery/read state the way Indian users expect from WhatsApp itself).
**Recommendation:** No code change recommended now. When messaging ships, treat "absence alert has no push channel" as the acceptance-test gap to close first, ahead of less consequential automated messages.
**Classification:** Product decision (correctly sequenced) / functional gap worth tracking

### F-6 — Test/seed tenants persist in the operator-facing Tenants list

**Severity:** Medium (P2)
**Role:** Ops
**Screen:** `/ops/tenants`
**Problem:** Three tenants named "Wave2 Joined" (auto-generated by a feature test script) sit in the live Tenants list next to the two real demo tenants, with no way to distinguish or filter them out.
**Evidence:** Screenshot of `/ops/tenants`; confirmed via read-only DB query that these tenants (`wave2-joined-*` slugs) exist as ordinary rows in `tenants`, `status = 'active'`, indistinguishable in schema from a real customer.
**Why it matters:** This is the same class of trust erosion the previous audit flagged in the Feature catalogue (X-D4, now fixed there) — "if this list has fake stuff in it, what else does" — reappearing one level up in the one list ops staff treat as ground truth for which customers exist.
**Recommendation:** Either give e2e/test-provisioning scripts a teardown step (delete the tenant at the end of the run), or add a `is_test` / `source` flag to `tenants` that the Ops UI can filter on by default. The narrower, faster fix is teardown in the test scripts themselves, since it also prevents the underlying resource leak (each of these tenants also holds a pg-boss schedule row per `docs/demo-runbook.md`'s own description of what `db:deploy` reconciles).
**Classification:** Workflow problem / test hygiene

### F-7 — "Demo data" banner shows tenant-specific copy on the tenant-less Ops surface

**Severity:** Low (P2)
**Role:** Ops
**Screen:** All `/ops/*` screens, including `/ops/login`
**Problem:** The banner reads "Demo data — this is a demo tenant. None of this is real academy data," but Ops has no single tenant context — it manages all tenants on the platform.
**Evidence:** Screenshot of `/ops/login` and `/ops` showing the banner before and after authentication.
**Why it matters:** Minor, but it's exactly the kind of small inconsistency that tells a technically literate Ops user (the least forgiving audience in the product) that this banner was written for one surface and pasted onto another without adaptation.
**Recommendation:** Give the demo-mode banner a platform-appropriate variant ("Demo mode — this control plane manages demo tenants only") when rendered under the `ops.` host, or simply drop the tenant-specific clause on that host.
**Classification:** Microcopy / polish

---

## 5. Confirmed fixes from the previous audit (fresh evidence, not carried forward)

| Prior finding | Status | Fresh evidence this session |
| --- | --- | --- |
| 7.1 — Enquiries/Tenant status never color-coded | **Fixed**, with one regression (F-4 above) | `StatusBadge` shared component live on Owner/Reception Enquiries and Ops Tenants; `warn`/`good`/`late` render correctly, `neutral` does not |
| 7.2 (part) — "Mark churned" styled as plain neutral button | **Fixed, exceeded** | Destructive red variant + mandatory reason + explicit consequence copy + confirm/cancel modal |
| 7.3 — Native date input silently mis-stores DOB | **Fixed** | Masked `dd/mm/yyyy` `DateField` on both Owner and Reception Add-Swimmer forms; validates real dates; rejects `31/02/...`; correctly handles pasted ISO |
| R-D1 — Reception submit button precedes required content | **Fixed** | Button now renders after guardian/consent block in document order, with inline "Consent is required before saving" helper text |
| X-D4 — Feature catalogue polluted with e2e artifacts | **Fixed** | Scrolled full catalogue (12 features, 8 categories) — clean |
| X-D2 — Tenant status uncolored | **Fixed** | Same `StatusBadge` fix as above |
| C-D1 — No bulk mark-all, no Late state | **Fixed** (was reported as a gap; now resolved) | "Mark all N present" (count updates live) and a third Present/Late/Absent state both present and reload-tested |
| R-D5 — "Add Swimmer" heading Title Case | **Fixed** | Heading now renders "Add swimmer," sentence case |
| R-D4 — Reception "Me" showed wrong staff name | **Confirmed resolved** | "Receptionist Rhea" now shows correctly for that login |
| P-D3 — Generic 404, no branded not-found page | **Partially addressed** | Hitting an owner route while unauthenticated now returns a styled "We couldn't find that page" page with a "Go to sign in" action, rather than a bare Next.js 404 — an improvement, though it is not parent-specific the way `role-surfaces-plan.md` originally asked for on `/parent` itself (not re-tested this session; noted for completeness) |

Not retested this session (explicitly out of scope, carried as unknown per the previous audit's own caveat): the ZodError leak on an invalid member ID, and the Sessions-page UTC-vs-IST time bug. Their status remains unconfirmed either way.

---

## 6. Role scorecards

| Dimension | Owner | Coach | Reception | Parent | Ops |
| --- | --: | --: | --: | --: | --: |
| Learnability | 7 | 8.5 | 7.5 | 8.5 | 6.5 |
| Task efficiency | 7 | 9 | 8 | 9 | 7 |
| Clarity | 6.5† | 8.5 | 7.5 | 7‡ | 7 |
| Trust | 7 | 9 | 7.5 | 8 | 7.5§ |
| Error prevention | 7.5 | 8 | 8.5¶ | n/a | 8 |
| Error recovery | 7 | 8.5 | 7.5 | n/a | 8 |
| Mobile usability / **Desktop productivity** (Ops) | 8 | 8.5 | 8 | 9 | **7.5** |
| Information hierarchy | 6.5† | 8 | 7 | 8 | 7 |
| Role relevance | 8.5 | 9 | 8 | 8‡ | 7.5 |
| Functional completeness | 7 | 7.5 | 7.5 | 6‡ | 7 |
| **Overall** | **7.2** | **8.5** | **7.7** | **7.8** | **7.3** |

† Owner clarity/hierarchy dinged specifically for F-2's self-contradiction — otherwise this would score 8+.
‡ Parent clarity/completeness dinged for F-3 (terminology) and the still-unbuilt membership/fees card, not for anything about the zero-JS execution itself, which is excellent.
§ Ops trust up from the previous audit's 6.5, on the strength of the churn-confirmation fix — offset by F-6/F-7.
¶ Reception error-prevention scored higher than the previous audit's 7 specifically because the Add-Swimmer fixes (F-1's login bug aside) closed two of that audit's most concrete defects.

---

## 7. Overall product scores

| Dimension | Score /10 | Basis |
| --- | --: | --- |
| Indian usability | 5.5 | F-1 alone caps this — a login flow that rejects the default way a majority of the target market types their own phone number is a market-fit-level problem, not a polish one |
| Role-specific UX | 8 | Genuinely different, right-shaped surfaces per role; Coach remains the standout |
| Visual design | 8 (carried from prior audit — not re-scored, no new evidence to move it) | |
| Product clarity | 6.5 | F-2 and F-3 both directly damage "does the user understand what they're looking at" |
| Workflow efficiency | 7.5 | Coach register and Reception search are both genuinely fast; Owner Sessions/Ops Tenant-detail-at-mobile-width remain the outliers (not re-tested this session, carried from prior audit) |
| Trust | 6.5 | F-1 and F-2 are both trust-specific failures on the two screens (login, home) where trust is either won or lost in the first ten seconds |
| Mobile experience | 8 | Confirmed: zero layout overflow found on any tested screen this session either; touch targets consistently 44px+ |
| Desktop experience (Ops) | 7.5 | Real improvement in the tenant-detail layout at native width; churn-confirmation flow is a genuine strength |
| Accessibility | 7 | 44px targets, aria-labels present on icon-only register buttons, no color-only status communication observed (every badge carries text) |
| Consistency | 7 | Shared `StatusBadge`/`DateField`/`Button` components are real and mostly correctly applied; F-3 and F-4 are exactly the kind of scope-gap that a still-maturing component system produces |
| Functional completeness | 6 | Honest about what's missing, but payments/messaging/payroll/facilities are all Phase 2/3-not-started, and that's most of the original pitch |
| Real-world club suitability | 6 | Would not be recommendable to a real club today with F-1 unfixed — everything else in this report is worth fixing, but F-1 is the one that would generate support calls on day one |

---

## 8. Prioritization

### P0 — Must fix before this could go in front of a real club
1. **F-1** — phone-number login normalization (bare 10-digit numbers).

### P1 — Should fix soon, materially damages trust or correctness today
2. **F-2** — Owner home's contradictory "today" sections.
3. **F-3** — parent page terminology bypass.
4. **F-4** — invisible "neutral" status badge on Enquiries.

### P2 — Worth doing, lower urgency
5. **F-6** — test tenants polluting the live Tenants list.
6. **F-7** — wrong demo-banner copy on Ops.
7. **F-5** — absence-alert delivery gap (track for when messaging ships; no action needed today).

---

## 9. Top 10 lists

### Top 10 UX problems
1. F-1 — login rejects the default Indian phone-typing pattern
2. F-2 — Owner home self-contradiction
3. F-3 — parent page ignores tenant vocabulary
4. F-4 — invisible neutral status badge
5. Owner Sessions / Ops Tenant-detail-at-mobile-width unprioritized length (carried, not re-tested — see prior audit §11)
6. Coach "Me" and Reception "Me" are near-empty stubs with no path forward visible to the user
7. F-6 — test tenant pollution in Ops
8. F-7 — Ops demo-banner copy mismatch
9. Reception "Today" remains a dead-end single card (carried, roadmapped)
10. No visible way for a first-time user to tell, from the login screen alone, what phone format is required (contributing cause of F-1)

### Top 10 functional problems
1. No messaging provider — absence alerts, fee reminders (once billing ships) have no push channel (F-5)
2. No payments/invoicing anywhere (confirmed still true, correctly sequenced, Phase 2/3)
3. No payroll/staff-pay surface — Coach "Me" cannot show what the product's own pitch promises
4. Parent surface is a single read-only page with no fees/progress card (billing-blocked, expected)
5. Ops Tenants list has no test/real distinction (F-6)
6. F-3 — terminology system has a scope gap on the parent surface
7. Reception Today has no quick actions (roadmapped, not new)
8. No accountant dashboard (role exists for permission tests only — expected, documented)
9. Ground staff has no surface at all (expected, documented open decision)
10. Staff detail pages are read-only (documented gap, not tested fresh this session)

### Top 10 psychology / trust problems
1. F-1 — a wrong-format error indistinguishable from a wrong PIN, with lockout risk
2. F-2 — two contradictory "today" claims on the owner's most-viewed screen
3. F-3 — a parent seeing the wrong vocabulary on the one artifact the club hands them
4. F-4 — a status that's supposed to communicate at a glance instead disappears
5. F-6 — fake tenants in the one list ops staff trust as ground truth
6. Absence alerts that can't reach anyone proactively undercut the product's core "catch it before they quit" promise (F-5)
7. The generic post-login-expiry 404 (improved this session, not fully parent-specific — see §5)
8. Coach "Me" page's emptiness is a visible reminder of unbuilt payroll promises
9. F-7 — banner copy that doesn't fit its own surface, a small but real "this wasn't checked carefully" signal
10. No delivery/read-receipt language anywhere yet (expected, given no messaging exists — flagged as a forward-looking watch-item, not a current defect)

### Top 10 mobile problems (Ops excluded per audit rules)
1. None of the previous audit's mobile-layout-overflow findings reproduced — zero new overflow found this session either, at 390/375/430px on every screen tested
2. F-1's login error is equally bad on mobile and desktop — no mobile-specific amplification found
3. F-2's contradiction is fully visible without scrolling on a 390px screen — arguably worse on mobile, where there's less room to "explain itself" with surrounding context
4. Reception's empty "Today" card wastes valuable above-the-fold mobile space
5. Coach "Me" page's blank space below the two-line stub is more visually jarring on a tall phone screen than it would be on desktop
6. (No further genuinely new mobile-specific problems found this session beyond what's captured above — the mobile experience is, on the evidence gathered, in materially good shape)

### Top 10 desktop/Ops productivity problems
1. F-6 — no way to filter test tenants out of the working view
2. F-7 — banner copy mismatch
3. Ops Overview still has no live stats (carried, confirmed still true)
4. No bulk actions observed anywhere in Ops (Tenants list, Feature catalogue) — every action is one tenant/feature at a time
5. Tenant detail's Owner-invite step sits below a Settings table and three stat tiles rather than being immediately actionable from the top of the page for a brand-new tenant
6. No visible tenant search-as-you-type debounce indicator (minor — search itself works, just no loading affordance observed)
7. (Remaining desktop items carried from the prior audit's still-valid findings, not re-argued as new)

### Top 10 strengths
1. Coach register: bulk mark-all, Late state, 44px targets, live save timestamp, reload-durable — the standout screen in the product, now with two previously-missing capabilities confirmed shipped
2. Zero-JS parent page: genuinely zero script tags, correct dates, honest expiry copy, correct present/absent coloring
3. Ops "Mark churned" flow: destructive styling, mandatory reason, plain-language consequence statement, cancel path — a model for how a dangerous action should be gated
4. Masked `DateField`: real date validation, correct day-first masking, handles pasted ISO gracefully — closes a genuine child-data-integrity risk
5. Reception search: fast, debounced, works from partial phone digits — matches the actual reception-counter workflow
6. Reception Add-Swimmer guardian/consent flow: correct DPDP modelling, now with correct document order
7. Shared `StatusBadge` component: real, reused across three roles, correctly token-driven where it works
8. Honest empty states throughout: no fake money tiles, no invented profitability charts, no phantom WhatsApp buttons for a channel that doesn't exist
9. Ops tenant detail at native desktop width: sensible top-to-bottom priority (status actions → settings → stats → owner)
10. Consistent 44px+ touch targets and zero layout-overflow found across every screen tested at three mobile widths

---

## 10. The five changes that would most improve real-world usability

Ranked by frequency × user impact × trust cost, not by implementation effort.

1. **Fix the phone-number login normalization (F-1).** Every other finding in this report is reachable only by a user who successfully logged in. This is the one fix that gates all the others in practice, affects 100% of users in every role, and would generate real support calls on day one if shipped as-is.
2. **Make the Owner home screen internally consistent (F-2).** The home screen is the product's single highest-frequency, highest-trust surface — it's where an owner decides, every single day, whether this software actually knows what's going on at their club.
3. **Wire terminology into the parent page (F-3).** Low effort (two string interpolations in one file), disproportionate trust payoff — this is the one artifact a club's own customers see.
4. **Fix the invisible neutral status badge (F-4).** A one-line CSS change that closes the exact gap yesterday's fix was meant to close.
5. **Give test-provisioning scripts a teardown step, or flag test tenants in Ops (F-6).** Cheap, prevents a recurring, compounding trust cost every time someone runs an e2e script against a long-lived database — which, as this very session demonstrated, is exactly what happens in practice.

---

## 11. Final product judgment

1. **Does Aqua feel designed for Indian sports clubs?** Mostly — cash-and-phone-first assumptions, dd/mm/yyyy dates, sentence-case English, no forced app-install for parents. Undercut specifically by F-1, which fails the one interaction every Indian user does first.
2. **Does each role feel purpose-built?** Yes — Coach, Owner, Reception, Parent, and Ops are visibly, structurally different surfaces built around different jobs, not one dashboard with hidden buttons.
3. **Does it help people do their jobs rather than manage software?** Mostly yes for Coach and Reception (the two highest-frequency, most time-pressured roles); less so for Owner today, specifically because of F-2's self-contradiction on the one screen meant to save her from checking multiple sources.
4. **Can a first-time user understand the important screens?** Yes, with two concrete exceptions: the login screen doesn't communicate its phone-format requirement, and the Owner home screen momentarily contradicts itself.
5. **Are common tasks fast enough?** Yes — coach register marking and reception search are both genuinely fast, reload-tested, and match the physical/time constraints of their real environments.
6. **Does the application create trust around money?** Not yet testable — no money surfaces exist. What does exist (audit trails, honest empty states, no invented numbers) is a good foundation for when it does.
7. **Does attendance feel reliable?** Yes — this remains the product's best-built feature, now with a bulk action and a Late state that were previously missing.
8. **Does the WhatsApp-oriented workflow feel natural?** Not yet testable — no messaging exists. The one feature that depends on it today (absence alerts) is honestly built but functionally inert without a push channel.
9. **Does the mobile experience match real Indian frontline usage?** Yes on the evidence gathered — no overflow, correct touch targets, fast interactions, across three mobile widths.
10. **Does Ops provide a productive desktop experience?** Reasonably — real improvements since the last audit in tenant-detail layout and the churn-confirmation flow, offset by test-data pollution and a still-empty Overview.
11. **Does the product feel modern without becoming complicated?** Yes on the screens that are fully built (Coach register, Settings, Parent page); the screens with the most cognitive friction are exactly the ones with an internal inconsistency (Owner home) or an unbuilt dependency (Coach Me, Reception Today).
12. **Does the application feel coherent despite role-specific differences?** Mostly — the same tokens, components, and terminology system are visibly shared everywhere except the one architecturally-separate surface (parent page) that got missed.
13. **Does it feel like a sports-club operating system rather than a generic CRUD/SaaS dashboard?** In the built parts (attendance, member lifecycle, vocabulary, settings), genuinely yes. In the unbuilt parts (money, messaging, payroll), there is currently nothing to feel — which is honest, but is also most of the original promise.
14. **The five changes that would most improve real-world usability:** see §10 above — fix login phone normalization; fix the Owner home contradiction; wire terminology into the parent page; fix the invisible status badge; give test data a teardown or a flag.

---

## 12. Implementation status (2026-09-13, same day)

Recorded by the implementing session. Every item was browser-verified against a
running `next dev` (mobile 390×844 for frontline roles, 1280×900 for Ops), and
the standard gate (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`)
was run.

| Finding | Status | What changed |
| --- | --- | --- |
| **F-1** — phone login rejects bare 10-digit numbers | **Fixed** | `lib/services/credentials.ts::pinLogin` now normalises through the shared `normaliseToE164` (was: strip spaces + leading-0 only). `components/login-form.tsx` uses the same helper, shows the canonical `+91 …` form on blur, and adds a "Mobile number" label + "any format works" hint. Live-verified: bare `9000000001` + PIN → `/owner`. Regression tests added in `tests/auth/credentials.test.ts` and `tests/auth/login-form.test.tsx`; the service test was proven red against the old code. |
| **F-2** — Owner home's two "today" sections contradict | **Fixed** | `components/owner-dashboard.tsx` keys the "Nothing scheduled today" branch off `todaysLanes.length` (the actual schedule), not `todayTotal` (enrolments). A day with a session but no enrolments now reads "1 session scheduled · no swimmers enrolled yet". Live-verified with the exact lane from the audit. Test added in `tests/mobile/dashboard-and-lists.test.tsx`. |
| **F-3** — parent page ignores tenant terminology | **Fixed** | `app/p/[token]/route.ts` resolves `member` and `session` terms via `resolveTerm` and threads the strings into every label ("Swimmer view", "Swimmer", "Next session/slot", attendance copy, expired-link copy). Zero client JS preserved (verified `document.querySelectorAll('script').length === 0`). Live-verified on the swim tenant ("SWIMMER VIEW") and the football tenant ("NEXT SLOT", "3 of 3 slots"). New `tests/vocab-route-handlers.test.ts` scans `app/**/route.ts` for hardcoded vocab (the L3 scan only read `.tsx`) and pins the route's use of the resolver. |
| **F-4** — invisible neutral status badge | **Fixed** | `components/ui/StatusBadge.tsx`'s `neutral` tone is now `bg-paper text-ink-2 border border-line`. Live-verified on Owner and Reception Enquiries: computed bg `rgb(255,255,255)` + 1px `line` border against the `rgb(237,240,236)` page. |
| **F-5** — absence alerts have no push channel | **Requires Product Decision** | No code change by design (the audit itself recommended none until messaging ships). Tracking note stands: when WhatsApp/messaging lands, push delivery + delivery state should be the first acceptance-test gap closed. |
| **F-6** — test tenants pollute the Ops list | **Partially Fixed** | The three live `wave2-joined-*` rows were removed with the guarded dev-orphan sweep (extended in `scripts/l5-clean-dev-orphans.ts` to cover the `wave2-joined-` prefix). Ops Tenants now shows only the real demo tenants (live-verified). The permanent half — an `is_test`/`source` flag the Ops UI can filter on, or deleting tenants from the control plane — needs a schema/product decision (stop-and-ask rule); committed tests already run against disposable containers and tear down. |
| **F-7** — tenant demo-banner copy on the tenant-less Ops surface | **Fixed** | `components/demo-banner.tsx` remains the server gate for `DEMO_MODE`; the visual strip (`components/demo-banner-strip.tsx`) picks platform copy under `/ops` via `usePathname` (SSR-safe, no hydration flash). Live-verified on `/ops/login` and authenticated Ops screens. Tests updated (`tests/mobile/demo-banner.test.tsx`), tier1 source pins intact. |

Carried/wider items from §9 (Coach "Me" and Reception "Me" stubs, Reception
Today's dead-end card, Ops Overview's empty stats band, Owner Sessions /
Ops tenant-detail at mobile width) remain **Not Implemented** — they are
roadmapped elsewhere and were outside this audit's numbered priorities.

One unrelated pre-existing test failure was observed and confirmed on the base
working tree (stash-test): `tests/migrations/invite-persons-staff-backfill.test.ts`
fails 7/7 with an FK violation against the shared dev DB. Not caused by, and not
in scope of, this audit's fixes.
