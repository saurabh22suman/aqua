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
