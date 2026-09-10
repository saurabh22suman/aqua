# Owner surface fixes

Bugs and rough edges on owner-facing surfaces, each captured at the
level of its smallest coherent unit: what the bug was, where it lived,
why it existed, and what would have surfaced to the operator in
production. Future readers should be able to see the "why" without
chasing the diff.

## Terminology editor — English plural preview double-s

**File:** `components/terminology/terminology-form.tsx`, the `en.plural`
template at the `SAMPLE_SENTENCES` map. **Test:**
`tests/tier1/terminology-preview.test.ts` pins the shape for every
default plural (`members`, `batches`, `coaches`, `sessions`,
`programs`, `facilities`, `guardians`, `enquiries`) and every plausible
override (`swimmers`, `boxes`, `programmes` UK, `kids`, `staff`); also
pins the Hindi/Bengali branches so the next locale added doesn't
inherit the same shape by copy-paste.

The English plural template was
`` `12 ${n}s marked present` ``, with the `s` hard-coded after
`${n}`. `resolveTerm` in `lib/terminology/keys.ts` is correct — it
returns the operator's plural verbatim — but the editor preview line
in `components/terminology/terminology-form.tsx` was a copy-paste of
an English-default template that appended its own `s` on top, so a
swim club that renamed "member → swimmer" saw the preview render
`"12 swimmerss marked present"` (and `"batchess"`, `"coachess"`,
`"enquiriess"` for the other keys — `enquiries` was the only one
that happened to look right because the `y → ies` form was
pre-baked into the default).

**Production impact:** the bug lived in the preview only — runtime
copy goes through `resolveTerm` and is fine — so the only customer-
visible artefact was the operator seeing `"12 swimmerss"` flash by in
the editor on the very row they were about to rename. That is exactly
the moment they decide whether the rename is safe to commit, so a
misleading preview is enough to either ship a confusing rename or
push the operator to revert a change that was actually correct. The
fix is one character: drop the hard-coded `s` so the template is
`` `12 ${n} marked present` ``.

## Loading skeletons for cold-load routes

### The problem

Every Server Component page on the owner and coach surfaces does an
`await Promise.all([...])` over its data, then renders. While that
runs the user sees a blank document — no header, no skeleton, no
"loading" indicator. The cold-load on `pnpm dev` was measured at
**2–7 seconds per route** in the audit; specific worst cases were
`/login` at 6.5s and `/p/[token]` at 2.1s. On a coach's phone at
the poolside that window reads as "the app is broken," which is
exactly the failure mode `DESIGN.md` §3 ("skeletons, never
spinners") is built to prevent.

### The fix

Add a route-level `loading.tsx` at each Server Component boundary.
Next.js streams them to the browser **immediately**, while the
page's `Promise.all` over its actions is still resolving. This is
the actual win — the streaming, not the skeleton prettiness. The
user sees the page's shape (header, hero, lists) within tens of
milliseconds; the data fills in as each action completes.

### Why this works

`loading.tsx` is a Next.js App Router convention. When a route has
one, Next.js treats it as the boundary's "instant render" — it
serves the skeleton the moment navigation resolves and replaces it
with the real page once `await Promise.all([...])` settles. The
work is *not* in the skeleton component; it is in Next's
suspense-and-stream plumbing being given a meaningful boundary to
stream.

### What was changed

| Route | Replaces existing? | Skeleton shape |
|---|---|---|
| `app/(owner)/owner/loading.tsx` | new | header row · 1 hero card (3.5rem) · 3 stat chips (3.5rem) · "Needs you today" list (4 rows) · "Today's facilities" list (2 rows) |
| `app/(owner)/owner/members/loading.tsx` | new | heading + Add button · search box · status filter chip · 8 list rows (avatar + 2 lines) |
| `app/(owner)/owner/reports/loading.tsx` | **yes** (was 3 thin `SkeletonCard`s, no period or card content) | heading · period meta · 4 cards stacked (heading + 8 skeleton rows each) |
| `app/(coach)/coach/loading.tsx` | new | "Today" heading · 2 register-link rows |
| `app/(coach)/coach/register/[sessionId]/loading.tsx` | new | sticky header (mark count + lane strip) · 8 register rows |

All skeletons use the existing `<Skeleton>` primitive from
`components/skeleton.tsx` — no new component. Heights follow the
real font sizes from `DESIGN.md` §1.3 (h=N means N×4px), so a
heading-shaped block reads as the heading that's about to arrive.

### Routes intentionally not covered

`/owner/batches/[batchId]` and `/owner/staff[/...]`,
`/owner/onboarding`, `/owner/settings/...` already had their own
`loading.tsx` files before this change — left untouched. The five
above were the gaps the audit found.

### E2E verification

The mechanical proof is the dev-server log: `pnpm dev` then visit
each route in a cold browser, watch for `Compiling /<route>`
followed by `GET <route>` returning the skeleton HTML (look for
`bg-deck animate-pulse` in the response) before the page settles.
This is documented here rather than scripted because restarting the
dev server mid-suite would mask the very regressions this change is
built to prevent. The companion test
`tests/tier1/loading-files.test.ts` pins the invariant
mechanically: each route in the table above has a present,
structurally-thick `loading.tsx` that imports from
`@/components/skeleton`. Mutation-tested by stripping
`<Skeleton w=` usages from one file — the test flips red.

### Files touched

```
app/(owner)/owner/loading.tsx
app/(owner)/owner/members/loading.tsx
app/(owner)/owner/reports/loading.tsx         (replaced)
app/(coach)/coach/loading.tsx
app/(coach)/coach/register/[sessionId]/loading.tsx
tests/tier1/loading-files.test.ts             (new)
docs/owner-fixes.md                           (this file)
```

## Offline sync banner on the coach register (now visible)

### The gap

`/coach/register/[sessionId]` is the surface the product is designed
for: a coach, poolside, on flaky 4G, marking attendance. The hook
`useOfflineRegister` (`lib/hooks/use-offline-register.ts`) already
exposed every signal the coach needs — `pending` (count of unsynced
local marks), `online` (boolean), `hasActiveFailure` (boolean), and
`syncedLabel` — but the component `components/register-board.tsx`
used to render only one of them. The visible signal was a tiny
`sync-state` text node inside the sticky lane strip — *"offline —
saved on device"* or *"syncing N…"* — small enough that a coach
marking attendance during a connectivity blip had no affirmative
signal that the mark was durable on the device. Worse, the
"couldn't sync" path was a single red `<p>` line below the lane strip,
easy to miss when scrolling.

The product's load-bearing promise to the coach is "your mark is
saved locally and will sync when you're back online" (architecture
§12). The UI was not visibly making that promise.

### The fix

A persistent three-state banner, rendered above the lane strip and
inside the sticky container (so it stays in view when the coach
scrolls down through the roster):

| State | Banner | Token |
|---|---|---|
| online + no pending + no failure | none | — |
| online + hasActiveFailure | red *"Couldn't sync N marks. Tap to retry."* | `late` |
| !online + pending > 0 | amber *"N marks saved locally. Will sync when you're online."* | `warn` |
| otherwise (e.g. online + pending > 0) | none — the lane strip already shows *"syncing N…"* | — |

The tap on the red banner calls `retrySync()` (added to the hook's
return shape) which delegates to the existing internal `flush()` —
same gate, same effect as the 4s timer or the `online` event firing.
A retry while offline or while a flush is already in flight is a
no-op, which matches the prior flush semantics exactly.

### The state machine

Render-side, in priority order (most actionable first, so the
visible signal lines up with what the coach can actually do):

1. `online && hasActiveFailure` → red banner (tap = retry)
2. `!online && pending > 0` → amber banner
3. otherwise → no banner

The online + pending > 0 case is intentionally not a banner: the lane
strip's *"syncing N…"* text already says it. A coach who sees that
text and the lane strip filling up already knows the sync is in
flight.

### Note

Hook state was already observable (`pending`, `online`,
`hasActiveFailure`, and now `retrySync`). The fix is purely a
rendering change plus the small `retrySync` extension to the hook's
public surface so the banner can be a tap target rather than a
read-only label. No new hook state, no new mutation, no new
dependency.
