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

## Inline member edit (click-to-edit on the detail page)

### The gap

`/owner/members/[memberId]` is the surface a coach/owner opens for
the small data fix — "the phone number has a typo", "the DOB was
entered a year off", "they're `other` not `male`". Until now, every
one of those fixes meant a full navigation to `/owner/members/[id]/edit`,
losing the member context (status row, enrolment, attendance card) and
then a navigation back. For a six-character correction on one field,
that's a round-trip that earns nothing.

### The fix

Five fields on the member detail page are now editable inline, in
place, without leaving the page:

| Field | Type | Edit trigger |
|---|---|---|
| Full name (`persons.full_name`) | text | blur or Enter |
| Phone (`persons.phone`) | text | blur or Enter |
| Date of birth (`persons.date_of_birth`) | date | change (no blur) |
| Gender (`persons.gender`) | select | change (no blur) |
| Medical notes (`persons.medical_notes`) | textarea | blur |

Each field renders as text by default. A 44×44 pencil button appears
on hover/focus of the row; clicking it switches to an input. There is
no Save or Cancel button — blur commits, Enter commits, Escape
cancels. Save is optimistic: the displayed text changes immediately.
On failure, the display rolls back to the original and an inline
error appears beneath.

A short `Saved · Xs ago` micro-text appears for ~4 seconds after a
successful save. Pencil icons are imported individually from
`lucide-react` (the bundle budget rule for icons), and the inputs
are 16 px font size (DESIGN.md §2 — iOS zoom-on-focus).

The implementation lives in
`components/member-detail/inline-edit-field.tsx`. It's one client
component configurable for text / date / select / textarea. The page
passes the full member snapshot so the underlying `updateMemberAction`
(which requires `fullName`, `dateOfBirth`, `locationId`) can be called
with all required fields even when only one field changed.

### Out of scope (still on the separate edit page)

The following are intentionally still routed through
`/owner/members/[id]/edit` until they have their own inline affordance
in their own PRs:

- Status transitions (`MemberStatusPanel` — move to paused / lapsed /
  left, with reason capture)
- Enrolment (`MemberEnrolmentPanel` — batch assignment, transfer,
  leave)
- ID card (`MemberIdCard` — print/download surface)
- Parent link (`ParentLinkPanel` — guardian attach/detach)
- Attendance — read-only on the detail page; the live surface is
  `/coach/register/[sessionId]`
- Consent — grant/withdraw has its own DPDP-mandated flow

Mixing any of these into the inline editor would either (a) bloat
`InlineEditField` past the point where the click-to-edit affordance is
still fast and obvious, or (b) require a Save/Cancel button to capture
multi-field intent (enrolment, status-with-reason) — and the explicit
goal here is no Save button, blur to commit. Each of those flows has
its own shape and gets its own PR.

### Note on the existing Edit link

The header Edit link in the top-right of the member detail page is
left intact. The inline editor covers the five fields above; for
anything else, the link still goes to the same
`/owner/members/[id]/edit` page as before. Removing it is a separate
PR (it would be a backward-compatibility break for any coach who has
the muscle memory of "Edit → fix → Save"). Same for any external link
that points at the edit URL.
