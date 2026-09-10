# Owner surface fixes

Bugs and rough edges on the owner surfaces, each fixed at the level of
its smallest coherent unit, with a short note on what was missing and
what was added. Cross-references the section of `docs/architecture.md`
or `DESIGN.md` each one ties to, so a future reader can see the
"why" without having to chase the diff.

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
