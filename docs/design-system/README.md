# Aqua UI system — implementation handoff

Setup prepared 26 October 2026. This directory defines the new design program;
it does not certify implementation. OpenCode agents own code changes.

Read [engineering standard](../engineering-standard.md), [visual/component
contract](visual-contract.md), [motion](motion.md), [PWA](pwa.md), then the
[delivery lanes](delivery.md). Root DESIGN.md remains the incumbent contract;
the foundation owner must reconcile it with these explicit human decisions.

## Approved direction

- Two LIGHT presets only: **Mint Garden** and **Lavender Club**. Mint is the
  initial default; theme selection is a personal preference, not tenant branding.
  One layout, typography, spacing and component behavior across both themes.
- Owner, coach, reception and any authorized customer/member surfaces are
  mobile-first and responsive. Ops is desktop-first and responsive.
- Use selected shadcn/ui copied-source primitives compatible with Tailwind v4;
  keep Aqua domain wrappers and Apache ECharts. Do not add MUI alongside it or
  bulk overwrite existing components/globals via CLI scaffolding. Record exact
  compatible package versions and incremental bundle cost before additions.
- Existing functionality, permissions, mocks and data remain. No new customer
  booking platform, paid provider, pricing flow or auth scheme hidden in a UI task.
- Lightweight motion and installable tenant PWA are requirements. Existing
  offline attendance security must be retained; installability is not universal
  offline capability. Parent token pages retain zero-JS and no-store.

## Interpreting the eight-screen reference

| Reference screen | Aqua decision |
| --- | --- |
| Intro/splash | Native PWA launch appearance/icon only; no artificial timed splash or network delay |
| Welcome | Brief purpose only where useful at first entry; returning staff go straight to work |
| Login | Restyle existing phone/code/PIN journey, keep existing authentication and recovery |
| Onboarding | Optional role-relevant first-use tips and owner setup checklist; skippable, not a carousel on every login |
| Home | Role-specific tasks, truthful summaries and useful charts |
| Profile | Existing account/me surface, role-appropriate editable details and sign-out |
| Settings | Grouped operational settings; personal Appearance and motion preference discoverable |
| Subscription | Owner-visible existing membership/billing context only; no forced upsell/paywall or invented platform plans |

Do not add routes simply to reach eight. Existing parent/customer capability is
limited: map it honestly and keep future product work out of this redesign.

## Evidence and baseline

Completed owner, chart, seed and harness work is preserved in the coordinator's
local source checkpoints. Local execution assignments, session identifiers,
credential profiles and the copied private planning conversation are not
published in this public repository. The integration PR records its source
revision, independent checks and remaining blockers; it does not constitute a
production deployment or human visual acceptance.

Feature agents continue in isolated worktrees. New work must be reconciled with
the reviewed develop baseline before integration. Existing test failures are not
waived. CI optimization changes remain a separate review scope.

Visual previews in references/ are inspiration with illustrative data and image
rendering errors. Exact chart figures, dates and component behavior must come
from real scoped data, never from generated pixels. Do not blindly copy avatars,
placeholder counts, gradients, overlarge spacing or chart label mistakes.
