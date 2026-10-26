# Aqua UI acceptance contract

Effective 26 October 2026. Applies to new UI work and review; existing violations
are defects to track, not an instruction to silently redesign every route.
DESIGN.md owns visual tokens and approved compositions; this file owns behavioral
acceptance and evidence. Do not duplicate token values here.

## Shared shell and scrolling

- Owner desktop shell has a viewport-bound sidebar that stays visible while the
  main page scrolls. If navigation exceeds the available height, only its nav
  region scrolls; branding and account/exit controls remain reachable. Specify
  the scroll owner before implementation. Use one main vertical scroll owner;
  avoid accidental body + content double scrollbars. Tables may scroll sideways
  within their own labeled region without moving the page sideways.
- Keep the search/header visible during long-page scrolling. Sticky offsets,
  stacking and clipping must work with location switchers and any banners.
  Fixed/sticky UI must not cover focused controls, dialog content or anchors.
- Sidebar width, selected/hover/focus states, grouping, content gutters, heading
  baseline and header height come from shared shell/components, not route-local
  copies. Active child routes highlight the right parent; permission-limited
  roles see only authorized destinations and can still sign out.
- Mobile uses the approved four-item navigation, safe-area clearance, accessible
  search/account routes and no desktop sidebar. Check transition around the
  actual installed breakpoint on both sides; do not infer it from screenshots.
- Short screens must retain access to every navigation item and exit control.
  At 200% zoom, reflow or provide usable navigation; never clip it to fit.
- Route navigation restores the intended main-page position; browser Back and
  filters retain expected list position/state. No nested scroll traps.

## Component consistency and information hierarchy

- Reuse shared Button, form, table/list, card, tabs, status and empty-state
  primitives after inspecting their implementation. Do not approximate them
  with new page-specific classes or solve a shared issue on one route only.
- Use DESIGN.md tokens for typography, spacing, radii and colors. One dominant
  primary action per task context; secondary actions have real spacing and
  clear hit areas. Keep destructive actions distinct and confirm as required.
- Working lists show counts, useful search/filter state and clear row actions;
  long names, INR amounts and validation messages must not collide or truncate
  important decisions. Forms have associated labels, field-level errors,
  pending/disabled/success feedback and recovery without losing input.
- Layouts balance useful information, not equal card counts. Avoid stranded
  narrow columns, huge accidental blank areas, stacked cards inside cards and
  arbitrary decoration. Do not add data solely to fill space.
- Summary, chart and drill-down figures reconcile for tenant, location, period
  and accounting meaning. Distinguish occupancy, register completion and actual
  attendance. Unknown attendance is not zero; overcapacity is visibly flagged.
- Charts use visible values/legends and accessible tables; controls work by
  keyboard, touch and pointer. Empty/loading/error/insufficient-history states
  are deliberate. Reduced motion is respected. Do not silently replace mobile
  charts with tables unless this behavior is approved and documented.

## Required browser proof for UI changes

For owner changes inspect 1280×900, 1024×768, 390×844 and a short desktop
1280×600 for shell work. Add widths immediately below/above the shell breakpoint
and 200% zoom for shell changes. Do not let viewport emulation leak to user tabs.

1. Identify branch, revision plus dirty diff, server cwd, URL and build mode.
2. Check actual loaded layout/styles after hydration. If dev and production
   differ, diagnose and report both. Inline-style patches are not a substitute
   for fixing missing CSS generation or serving the correct artifact. Never
   clear the human's offline cache/profile or kill their server uninvited.
3. For shell/shared primitives: inspect Home, long Members, Fees and Settings
   plus an open form/dialog and a permission-limited role. Other shared-role
   consumers need targeted checks. A Home screenshot alone is insufficient.
4. Scroll the long Members page from top to middle to bottom over main content.
   Confirm sidebar/header position stays stable (within rounding tolerance),
   then separately scroll an overflowing sidebar and reach its last item.
   Save top and scrolled viewport captures; a full-page image cannot prove this.
5. Check overflow at each viewport, keyboard/focus including a sticky boundary,
   long labels, populated/empty/filter-no-results, loading and error recovery.
   Use disposable fixtures for writes; no real payments or staff revocation.
6. Test every changed control's visible result, not just that a click succeeds.
   A chart/date/method drill-down must actually apply the matching filters.
7. Keep evidence with scenario, expected/observed behavior, dimensions and
   image path. Add a regression browser test for a confirmed shell/scroll defect
   using real rendered geometry, not assertions that a class string exists.
8. Report functional checks and visual acceptance separately. Browser reviewer
   returns PASS / CHANGES REQUIRED / BLOCKED; “modern/polished” is not established
   by typecheck, screenshots without inspection, or the builder's own claim.

## Reference direction pending design selection

Human references: https://in.pinterest.com/saurabh25031996/_pins/
- First: https://in.pinterest.com/pin/1110137376936260507/
- Fourth (PinHome): https://in.pinterest.com/pin/1110137376936260383/

Observed direction: a distinct colored sidebar, contained application canvas,
clear active navigation and deliberate grouping. These are inspiration for the
next design discussion, not approval to copy purple/teal, illustrations or alter
Aqua's current tokens now. Pinned images cannot prove scrolling or accessibility.

## Observed baseline, 26 October 2026

Chrome localhost:3100: Members scrolling removes sidebar contents from view.
Source owner-shell.tsx renders an aside without sticky/viewport constraints.
Home includes charts/overcapacity warnings, but Today and attention remain
stacked with a large empty desktop area in the current dev view. Agent reports
an isolated production view differs; the mismatch remains unresolved for the
human-facing server. These observations are open defects, not fixed by this doc.

Monthly chart check in the same Chrome session: Month renders ₹66,000 across
22 payments, Cash ₹63,000 (95%) and Digital ₹3,000 (5%). Chart panels have
excessive height/blank space and comparison/legend copy is visually dense.
These are design-review inputs for the next phase, not accepted polish.
