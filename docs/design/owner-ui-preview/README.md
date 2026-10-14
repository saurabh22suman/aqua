# Aqua owner UI — design preview (Prompt 3)

A runnable, isolated design proposal for the owner experience. It is **not
part of the Next application**: nothing under `app/`, `components/` or
`lib/` reads it, and it cannot reach the database, send notifications,
issue credentials or record payments.

- **Entry point:** `docs/design/owner-ui-preview/index.html` (served at `/`).
- **Run:** `pnpm preview:owner-ui`, then open <http://127.0.0.1:3210>.
  Override the port with `PREVIEW_PORT=3211 pnpm preview:owner-ui`.
- **Isolation:** the server (`scripts/preview-owner-ui.ts`) only reads its
  own folder plus the installed `@fontsource`, `lucide-react` and
  `boring-avatars` packages. It handles GET only, writes nothing, and
  imports no `db/`, `lib/services` or action module.
- **Interactions are local:** buttons that would mutate data show an
  explicit “preview only” note. Member search/filter, tabs, invoice
  expansion, the void confirmation and form validation all run client-side
  against synthetic fixtures.

## Screens

| Family | Pages |
|---|---|
| Owner Home | `/home` |
| Members | `/members`, `/member` (selected swimmer), `/member-new` (bounded editor), `/member-edit` (correction editor) |
| Fees | `/fees` (five tabs, default Dues with an expanded partial invoice) |

Recommended viewports: **1280×900** desktop and **390×844** mobile. The
slate-grey bar at the top is preview chrome; hide it before judging
composition. `?state=` selects a fixture state:

`populated` · `empty` · `loading` · `failed` · `limited` ·
`validation` (editors) · `confirm` (Fees).

## Captures

`captures/` holds the inspected renders:

- Desktop: `home-desktop`, `members-desktop`, `member-overview-desktop`,
  `member-new-desktop`, `member-edit-validation-desktop`,
  `fees-dues-desktop`, `fees-confirm-desktop`.
- Mobile: `home-mobile`, `members-mobile`, `member-overview-mobile`,
  `member-new-mobile`, `fees-dues-mobile`, `fees-confirm-mobile`.
- States: `state-home-empty|loading|failed-desktop`,
  `state-members-empty-desktop`, `state-fees-limited-desktop`.

## Files

```
docs/design/owner-ui-preview/
  README.md            this file
  DESIGN-NOTES.md      patterns, control→capability map, decisions, rollout, open issues
  index.html           preview entry point
  home.html
  members.html
  member.html
  member-new.html
  member-edit.html
  fees.html
  assets/preview.css   tokens mirrored from app/globals.css + preview components
  assets/preview.js    shell, state machine, local interactions, SVG trends
  captures/            inspected desktop/mobile renders
scripts/preview-owner-ui.ts   static server (+ /avatar.svg, /icon.svg, /fontsource)
```

## What this is not

- Not production code and not a redesign of the shipped pages; production
  integration is a later stage.
- Not a data or permission decision: every proposed control is mapped to
  its current capability in `DESIGN-NOTES.md`, and anything that would need
  a new capability is flagged there as a decision.
- Not a verification of Prompt 1/2; the open test pins and the
  `levels.write` policy question remain recorded in the Prompt 1/2 ledgers
  and in `DESIGN-NOTES.md`.
