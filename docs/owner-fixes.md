# Owner surface fixes

A running log of small, focused fixes against the owner/coach cold-load
path. Each entry names the problem, the route(s) it touched, and why
the change is the right shape rather than a workaround.

---

## 2026-09-10 — route-level `loading.tsx` for cold-load

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
