# Tenant mobile PWA contract

## Existing baseline and scope

Aqua already registers public/sw.js via components/sw-registrar.tsx and has
identity/session-scoped offline attendance, feature kill switches, logout purging
and offline privacy tests. Ops explicitly does not register that worker. No
complete app manifest was found during setup. Extend this system; never install
a competing catch-all worker, broad caching plugin or replace the privacy model.

Installable tenant experience serves owner/coach/reception and existing authorized
member surfaces from the tenant origin. Ops remains desktop-first; no offline
ops caching. Parent signed-token routes remain zero-JS, no-store, no-referrer and
must never enter caches, manifests/screenshots or install shortcuts with tokens.
PWA installability does not make financial/admin workflows work offline.

## Requirements

- Valid same-origin web manifest, stable app id/name/short_name, root entry that
  resolves to existing authorized role destination, scope/display standalone,
  background/theme color and suitable192/512icons including maskable assets.
  Reuse Aqua brand; no token/user IDs in start_url or shortcuts. HTTPS outside
  localhost. Install metadata must not leak onto ops or private parent surfaces.
- Honest install UX: contextual dismissible affordance, no login-blocking modal,
  no repeated nagging. Chromium install events only when available; iOS/iPadOS
  show accurate Add to Home Screen guidance. Do not invent one universal prompt.
- Safe-area and dynamic viewport handling, keyboard avoidance, native scrolling,
  browser Back/history and standalone navigation tested on Android and Safari.
- Useful offline fallback states, last-sync status and clear unsupported actions.
  Existing approved attendance queue may work offline only inside its identity,
  expiry and entitlement boundaries. Payments, fee edits, staff access and
  settings require online acknowledgement, no optimistic financial success.
- Never cache API/auth/RSC/private HTML indiscriminately. Define a route/method
  allowlist, bounded storage and expiration. Keep no-store/tenant/session isolation,
  revoked/expired identity behavior and logout purge. Do not silently broaden
  sensitive cache scope to make every page appear offline-capable.
- Version/update UX must protect unsaved input and pending attendance. No forced
  skipWaiting/clients.claim reload losing work; refresh only when safe/accepted.
  Never clear the human's browser profile or unsynced offline data during setup.

## The install ribbon (amendment, 30 October 2026)

Human request: *"the pwa pop up should be like a ribbon coming from the
side, and collapsable, and draggable if possible? like quick shortcut
things"*. This changes the PRESENTATION of the install affordance only.
The install policy below is unchanged: the same delay, the same visible
duration, the same month-long dismissal, the same session marker, the
same platform rules and the same exclusions.

The full contract is docs/design/pwa-side-ribbon-20261030/ribbon-contract.md.

- A small tab on the **RIGHT** edge opens the install options and folds
  them away again. The right edge is the placement of record: a
  left-edge ribbon would sit over the desktop sidebar navigation, and
  never obstructing navigation is the stronger requirement. The wording
  is horizontal — a rotated vertical word is unreadable.
- The ribbon arrives after the existing delay and **arrives collapsed**:
  it opens only when the person asks. An opening panel covered the
  page's filters, and an opening ribbon replayed its opening when the
  device came back online. It folds back into its tab after the
  existing visible duration instead of disappearing.
- While it is collapsed the ribbon is **one 44px tab**, sized to the
  shared control contract (WCAG's 24px minimum does not replace our 44px
  rule, so the tab is never narrowed to fit a tight page), and the move
  handle exists only while the ribbon is open. The tab keeps its 44px
  square and is *placed* where it covers nothing: inside the page's own
  right gutter where the gutter can hold it, otherwise in a place
  confirmed clear of every control — and where there is no such place
  the ribbon does not render, so it never covers a row or steals a row's
  click. Its hit area is exactly the visible tile, never an invisible
  extension. The place is re-checked, not decided once: the check covers
  the ribbon's actual position and runs again when the page scrolls, when
  content arrives late, and when the person drags it — a drag stops at the
  nearest clear place, and content moving over the ribbon makes it step
  aside until the place is clear again.
- It is never a modal: no dialog, no focus trap, no focus theft, no
  page blocking. Escape collapses it and returns the focus to the tab.
  It never folds away while the keyboard focus is inside it.
- A dedicated move handle — neither the install action nor the collapse
  control — drags the ribbon along the edge. Tapping the handle cycles
  three bounded stops and the arrow keys move it, so the ribbon is fully
  usable without any dragging. A drag never installs and never becomes
  a click; a cancelled gesture never swallows the next deliberate click.
- The ribbon stays inside the viewport: clear of the sticky header, the
  bottom navigation and the home indicator, and clamped again on resize,
  orientation change and visual viewport change. It hides while a modal
  dialog is really on screen — a dialog that is hidden, or that sits
  inside a hidden ancestor, is not an open dialog — and while a field
  outside the ribbon has the focus. A styled select counts as a field:
  a trigger built as a button or div with `role="combobox"` puts the
  ribbon aside while it has the focus, and the ribbon also steps aside
  while that select's options are open, so the options list can never be
  covered.
- Motion is a short transform/opacity slide from the edge, only on a
  user expansion, using the existing motion tokens, and stationary
  under reduced motion.
- The ribbon keeps the honesty rules above: the browser's own install
  event is called only by an explicit Install click, iOS gets accurate
  "Add to Home Screen" guidance, and nothing about the ribbon may
  suggest an install the browser cannot perform.

## TDD and acceptance

Write failing tests first for manifest metadata/icons/scope, ops+parent exclusion,
unsupported install API fallback, safe-area/navigation, stale worker update with
pending work, offline write refusal and identity/logout regression as applicable.
Reuse agent-owned tests; protected tier1 files are human-owned.

Verify production artifact, not just dev: manifest/icon fetches, launch routing,
standalone shell, offline fallback, update recovery and per-role permissions.
Desktop emulation alone cannot prove actual mobile installation; record real
Android/iOS installation as pending if no physical-device evidence is available.
Do not add push notifications, paid services or new offline data domains.

Sources: [web.dev PWA installation](https://web.dev/learn/pwa/installation/),
[manifest](https://web.dev/learn/pwa/web-app-manifest/),
[NIST secure lifecycle](https://csrc.nist.gov/projects/ssdf).
