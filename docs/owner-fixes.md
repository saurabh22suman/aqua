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
