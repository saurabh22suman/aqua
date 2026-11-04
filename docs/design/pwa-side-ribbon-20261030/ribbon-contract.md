# PWA install side ribbon — design contract (30 October 2026)

Human request: *"the pwa pop up should be like a ribbon coming from the side,
and collapsable, and draggable if possible? like quick shortcut things"*.

This is a PRESENTATION change to the install affordance. It is not an app
shortcut menu, a new product surface, a new product feature or a change to
the install policy.

## Baseline

The component this replaces is `components/pwa/install-affordance.tsx`: one
compact row (an install action and a dismissal) pinned above the bottom
navigation, which unmounted itself after its visible duration. The install
policy lives in `lib/offline/install-prompt.ts` and is **not** touched by this
work: the 4s delay, the 10s visible duration, the month-long explicit
"Not now", the once-per-session marker, the Chromium `beforeinstallprompt`
rule, the iOS guidance, and the login/Ops/parent exclusions all stay exactly
as they are.

The root captured the old pill baseline in the release candidate
(`outputs/pwa-side-ribbon-20261030/baseline.json`). That artifact lives in the
root's release-candidate tree, not in this lane's worktree.

## Placement — CORRECTED 30 October 2026 (root)

The first reading of the brief proposed the **left** edge, to keep away from
the row actions on the right of a list. Root corrected this after review:

* the ribbon is docked to the **RIGHT** edge on phone and desktop alike;
* the panel expands **inward, to the left** of the tab;
* the correction exists because a left-edge ribbon would sit on top of the
  desktop sidebar navigation, and "the ribbon must never obstruct
  navigation" is the stronger requirement of the two.

This is an ordinary placement decision inside the approved brief. It adds no
scope, changes no policy and no file ownership.

## The contract the implementation holds

1. **A tab, not a modal.** A small tab on the right edge opens the install
   options. The closed tab is a real hit target and its wording is
   horizontal — never a rotated, unreadable vertical word.
2. **Explicit expansion.** `aria-expanded` / `aria-controls` on the tab. No
   dialog, no `aria-modal`, no focus trap, no page blocking, no focus theft.
3. **It arrives COLLAPSED.** The ribbon appears after the existing 4s delay as
   a closed tab and opens **only when the person asks**. An opening panel
   covered the page's filters, and an opening ribbon also replayed its
   opening when the device came back online. It folds back into the tab after
   the existing 10s visible duration, and an explicit "Not now" is still
   remembered for a month.
4. **One 44px tab while collapsed.** The collapsed ribbon is a single tile —
   not a column of floating tiles — and it keeps the shared control
   contract's **44px target**: WCAG's 24px minimum does not replace our
   44px control rule, so the tab is never narrowed to fit a tight page.
   The move handle exists **only while the ribbon is open**.
   The tab is *placed*, not shrunk: it keeps a 44px square whose hit area
   is exactly the visible tile — there is no invisible extension, so it
   can never take a click that belongs to the page. Its position is
   confirmed against the page:
   * **gutter** — inside the page's own right gutter, when the gutter can
     hold the 44px tab (the desktop owner shell leaves 52px). Nothing is
     covered, on any scroll position.
   * **clear** — in a place confirmed clear of every control on the page,
     when the gutter is too narrow.
   * **none** — nowhere. The ribbon then does not render at all: a ribbon
     that covers a row, or that steals a row's click, is worse than no
     ribbon. A page whose right edge is full of row links therefore
     carries no ribbon; widening the phone's right gutter to 44px is a
     shell owner's change, not this lane's.
   The row actions and their labels stay readable and clickable either
   way.

   The place is **re-checked**, not decided once: a fixed ribbon can have
   the page move under it. The check covers the **actual** position, not
   only the preferred middle, and it runs again whenever

   * the page scrolls (the document or any scrollable region),
   * content arrives late (a row, a label),
   * the person drags the ribbon somewhere new.

   The recovery differs by cause, on purpose: the first placement looks
   for a clear place in the band; a drag stops at the nearest clear place
   so a drop can never land on a control; and when the page moves over
   the ribbon, the ribbon **steps aside** rather than jumping around, and
   comes back when the place is clear again.

   Two rules make the placement itself reliable:

   * the ribbon waits for the **real band**. The first render happens
     before the ribbon has measured itself, and an empty band has
     nowhere to put a 44px tab; placing it there would drop it on the
     sticky header.
   * the place is **found, never assumed**. The ribbon keeps the middle
     of the band only while that middle is clear; on a dense page the
     middle is exactly where the rows are, so the ribbon takes a place
     that was confirmed clear, and it follows the band when the band
     moves (a resize, a rotation, the ribbon opening) until the person
     places it themselves.

   **How the page is measured.** Controls are measured by their own box.
   Text is measured **per text node**, with a Range over that node — not
   with a Range over an element's contents, which (MDN: "aggregating the
   results of calls to Element.getClientRects() for all the elements in
   the range") also returns the descendant elements' boxes, so a
   full-width card or section would come back as one blocker spanning
   the page. The independent Chrome run of 30 October 2026 measured that
   difference: 398 whole-scope rectangles and **zero** clear places,
   against 395 per-text-node rectangles with clear places. The ribbon's
   own text is excluded from the measurement.
5. **Focus safety.** The ribbon never folds away while the keyboard focus is
   inside it or while it is being dragged. Escape collapses it and returns the
   focus to the tab.
6. **The move handle is its own control.** It is neither the install action
   nor the collapse control. It drags the ribbon vertically along the edge,
   and it is a progressive enhancement: tapping it cycles the three bounded
   stops (top / middle / bottom) and the arrow keys move it, so the ribbon is
   fully usable without any dragging at all.
7. **A drag never installs.** A drag that ends over the install action does
   not install and does not click. A **cancelled** gesture produces no click at
   all, so it must never leave a click-suppression waiting to swallow the
   next deliberate click. The page still scrolls everywhere outside the
   handle.
8. **Bounded placement.** The ribbon stays inside the viewport: it clears the
   sticky header (plus whatever the demo banner published as
   `--app-sticky-offset`), the bottom navigation gutter and the phone's home
   indicator. It is clamped again on resize, orientation change and visual
   viewport change, and the expanded panel always fits.
9. **It gets out of the way.** It hides while a modal dialog is **really on
   screen** — a dialog that is hidden, or that sits inside a hidden ancestor,
   is not an open dialog — and while an editable field outside the ribbon has
   the focus, so it never covers an active text field or the on-screen
   keyboard. A **styled select** counts as a field: a trigger built as a
   button or a div with `role="combobox"` suppresses the ribbon while it has
   the focus, and the ribbon also steps aside while that select's options are
   open (`aria-expanded="true"`), so the new options list can never be
   covered. This rule is the PWA ribbon's own presentation rule; it reads
   the DOM and knows nothing about the shared Select component.
   It comes back when the modal closes or is revealed, and when the field or
   the select closes.
10. **Quiet motion.** A short transform/opacity slide from the edge, only on a
    user expansion, using the existing motion tokens. No entrance flourish, no
    motion library, and a stationary presentation under reduced motion.
11. **Honest install.** The browser's own install event is called only by an
    explicit Install click. iOS and iPadOS get accurate "Add to Home Screen"
    guidance instead of a button that pretends to install.

## Review history

* **30 October 2026, first review (CHANGES REQUIRED).** The independent Chrome
  review found the collapsed ribbon as two floating tiles covering the
  Members row links, a collapsed ribbon that reopened itself when the device
  came back online, and a `role="dialog"` inside a hidden ancestor that
  suppressed the ribbon. Items 3, 4 and 9 above are that review's outcome.
* **30 October 2026, gesture diagnostic.** The tap-to-reposition works: the
  driver had sampled the geometry before the paint settled. The touch
  scenario was unproven only because the combined dev server served a stale
  Tailwind artefact (`touch-none`, `w-60` and `translate-x-3` were missing
  from the generated CSS). No pointer arithmetic was changed and no inline
  CSS was added to work around it.


## Boundaries

* No persistent position, no new storage key, no identity data. The ribbon's
  place on the edge is presentation state that dies with the page.
* No changes to the manifest, the service worker, the cache, permissions,
  credentials, the database, dependencies or policy.
* `lib/offline/install-prompt.ts` stays read-only for this work.
* The global stylesheet, the shared primitives and the shell are not edited.

## Owned files

* `components/pwa/install-affordance.tsx`
* `components/pwa/install-ribbon.tsx`
* `components/pwa/use-install-ribbon.ts`
* `components/pwa/install-ribbon-geometry.ts`
* `tests/pwa/ribbon-20261030/**`
* `tests/pwa/install-affordance.test.tsx` (only the assertions this brief
  supersedes) and `tests/pwa/install-offer-geometry.ts` (same)
* `docs/design-system/pwa.md` (the adjacent ribbon amendment)
* this folder


## Human revision — 30 October: direct browser install

For browsers supplying `beforeinstallprompt`, the single 44px side shortcut
invokes that saved event directly on deliberate activation. It never expands a
custom options card. Dragging repositions the shortcut and suppresses the
following click; a cancelled drag does not consume the next deliberate tap.
Arrow keys reposition it; native button Enter/Space activates installation.
Browser cancellation uses the existing month-long dismissal. No auto-install.

The 4-second delay, secure-context/standalone/offline rules, excluded sign-in,
Ops and parent surfaces, tokens and identity-scoped cache policy stay intact.
Chrome synthetic-event checks exercise our handler and geometry, not actual
OS installation. iOS retains truthful Share / Add to Home Screen guidance; its
expanded guide has NOT received final independent visual acceptance.

The previous 212 functional Chrome checks did not establish visual acceptance:
they checked the 44px tab while the expanded card occupied approximately
292×122px and obscured Members fields. New checks measure the complete visible
root before and after activation. The human-approved direct behaviour removes
that expanded Chromium footprint.
