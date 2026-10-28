# DESIGN.md

**The visual system for Aqua. Loaded on every UI task. Non-negotiable.**

## Design program — 2026-10-26

The current program is defined in `docs/design-system/` (README,
visual-contract, motion, pwa, delivery). This file remains the
incumbent contract and now carries the human decisions that program
introduced:

- **Two light presets only** — **Mint Garden** (default) and
  **Lavender Club**. One layout, typography, spacing and component
  behaviour across both. The preset is a *personal display preference*,
  not tenant branding, and it never carries a permission, a data scope
  or an identity.
- The palette is now **themed**: `app/globals.css` declares the base
  palette in `@theme` (Tailwind generates the utilities from it) and the
  second preset overrides it under `[data-theme="lavender"]`. Every
  utility resolves through `var(--color-*)`, so a preset swap needs no
  component change.
- The **action family** (`--accent`, `--accent-soft`, `--accent-ink`,
  `--accent-strong`) belongs to the preset; a tenant's branding accent
  paints the **academy mark** (`components/branding/tenant-mark.tsx`),
  not the action surface. §1.2 keeps the six approved tenant accent
  values and their "never a colour picker" rule for branding.
- The **shell** owns its scroll explicitly (§2) and the **foundation
  primitives** are inventoried in §3 with their states.

Everything below that is not contradicted by the above still stands.


## Redesign contract — 2026-09-21

The user requested a detailed redesign against `docs/images/*target*.png`
because the shipped screens feel bland. Execute
[`docs/ui-redesign-implementation-plan.md`](docs/ui-redesign-implementation-plan.md)
one task at a time. Its acceptance criteria are requirements, not claims that
the corresponding components have shipped.

- The PNG boards guide screen composition, hierarchy, density and workflows.
  Both owner boards depict **desktop** web apps; owner mobile needs its own
  responsive treatment. Do not infer fonts, weights or exact spacing from pixels.
- This document governs tokens, accessibility and interaction constraints;
  the implementation plan and project scope govern available features/data.
  The older HTML reference below remains useful, but its example money and
  messaging actions are not proof that their underlying features exist.
- Match the targets' useful structure: compact identity headers, meaningful
  summaries, clear primary actions, contextual tabs, readable rows, desktop
  tables, appropriate charts, and explicit state changes. Decoration is not
  a substitute for those elements. Record any deliberate target deviation.
- Mango is the **default**, not a universal requirement. Use the tenant's
  approved runtime accent, including marine where configured. Changing the
  system palette or adding decorative colour needs a recorded decision.
- Use the existing local SVG avatar for people, seeded by stable identity;
  `TenantMark` is academy branding, not a person's avatar. R1 has no photo
  upload. This is a product decision, not a claim that DPDP bans all photos.
- Check populated, unselected, selected, empty, loading, error, disabled and
  permission-limited states. Preserve Late and offline save/retry behaviour;
  do not add a cosmetic Save button to an auto-saving register.
- Token compliance alone is insufficient. Normal text (including meaningful
  labels and placeholders) needs 4.5:1 contrast, large text 3:1; applicable
  non-text controls/focus indicators need 3:1. Existing `ink-3` and white-on-
  mango combinations need remediation under UR-03; do not certify them just
  because they are tokens. Test native date fields in both en-IN and en-US;
  setting `lang` alone does not guarantee their displayed date format.

**Owner Home (2026-10-25).** The shipped composition, its component purposes
and the deliberate deviations from the Oct 2026 boards are recorded in §7.
§3 defines what each component is *for*; §7 defines how the owner's first
screen arranges them. Where the boards differ from §7 (growth deltas, a target
ring, weather, notification counts, an activity feed, a separate capacity
panel), §7 is authoritative.

This file encodes the tokens — colour, type, spacing, radii, shadow.
For redesign composition, use the relevant PNG board and UR task acceptance
criteria. `docs/sports-club-ui-direction.html` is the earlier **pattern**
reference for hierarchy, attention items and the lane strip's three reuses.
**Read these before building a screen.** Tokens alone don't tell you that one thing
per screen should dominate, or that an attention item states a reason
and not just a count — that's composition, and it lives in the HTML
file, not here. A screen that uses the right tokens in the wrong
composition still reads as generic.

This instruction was missing until an S1/S2-vs-reference audit found
real composition gaps that reading the HTML file first would likely
have caught (register rows as full cards instead of a lean divided
list, a generic progress bar instead of the coloured lane strip, bare
counts instead of reasons). Two of those findings were open at the
time; one is now closed. **Update (2026-09-13):** the lane strip's
owner reuse (per-batch capacity, Owner Home "Today's lanes") and coach
reuse (register/schedule marking progress) are confirmed **shipped**
— verified via computed style (6px track, correct `water`/`warn` fill
logic per session state) during the September audit. **Current update:**
parent membership runway and read-only money/receipts shipped in PR2–PR3.
Preserve their production zero-JS contract. Parent progress, schedule and
announcement expansion remain separate decisions, not missing billing data.

---

## The thesis

**Colour means money and attendance state. Nothing else.**

A coach reads a register at 6:45 AM in direct sunlight with wet hands. Green is present. Red is absent. Amber needs attention. If colour is also used decoratively, that system collapses and the screen has to be read word by word.

Everything below follows from this.

---

## 1. Tokens

### 1.1 Palette

```js
// Reference values from app/globals.css @theme (Tailwind v4)
{
  deck:    '#EDF0EC',   // page background — pool deck tile
  paper:   '#FFFFFF',   // card surfaces
  ink:     '#0F1F1C',   // primary text
  'ink-2': '#3C534F',   // secondary text
  'ink-3': '#5B6F6B',   // accessible muted text, icons
  marine:  '#0D3B36',   // hero blocks, dark surfaces
  water:   '#0E7C86',   // DATA only — charts, capacity, progress
  'water-soft': '#E3F1F2',
  line:    'rgba(15,31,28,.10)',

  // SEMANTIC — reserved meanings, never decorative
  good:    '#1F7A43',   // paid · present
  'good-soft': '#E4F4EA',
  late:    '#B2332B',   // overdue · absent
  'late-soft': '#FCE9E7',
  warn:    '#8F5400',   // needs attention
  'warn-soft': '#FDF0DC',
}
```

**Two presets, one palette shape.** The values above are the **Mint
Garden** default. The **Lavender Club** preset overrides the same token
names in `app/globals.css` under `[data-theme="lavender"]`:

| Token | Mint Garden | Lavender Club |
|---|---|---|
| `--color-deck` (canvas) | `#EDF0EC` | `#F6F3FB` |
| `--color-paper` (surface) | `#FFFFFF` | `#FFFFFF` |
| `--color-ink` (text) | `#0F1F1C` | `#2B1B3D` (aubergine) |
| `--color-ink-2` | `#3C534F` | `#4A3A63` |
| `--color-ink-3` | `#5B6F6B` | `#6B5A85` |
| `--color-line` | `rgba(15,31,28,.10)` | `rgba(43,27,61,.12)` |
| `--accent` / `--accent-strong` | `#1F5E3A` (deep forest) | `#4C2E93` (violet) |
| `--accent-soft` | `#DFEEE3` | `#EDE7FA` |
| `--accent-ink` | `#0F3220` | `#3A2170` |
| `--focus-ring` | `#1F5E3A` | `#4C2E93` |

Rules for a preset:

- **Light only.** Both presets are light: a light canvas with dark
  text. There is no dark mode.
- **The second preset restates every base colour.** A token that is not
  restated silently keeps the default value, so the preset contract
  test requires the full set (`tests/foundation/theme-tokens.test.ts`).
- **Semantic status colours are shared.** `good`/`late`/`warn` and their
  soft surfaces are *not* restated per preset: money and attendance
  meaning must not move with the theme.
- **The semantic layer** (`--surface-canvas`, `--surface-raised`,
  `--text-primary`, `--border-subtle`, `--action-surface`,
  `--selected-surface`, `--chart-1…5`, …) is written once in `:root`
  with `var()` references, so it follows whichever preset is active
  instead of being copied per preset and drifting.
- **The preset is validated as an enum.** Only `mint` and `lavender`
  are accepted; an unknown stored value falls back to the default
  preset. The value is a display preference — it is never read by an
  action, a query or a guard.
- **The stored preference is a cookie** (`aqua_theme`), read by the
  server on the request that renders the page, so the first paint
  already carries the right palette (no flash). The switch writes the
  cookie and updates `<html data-theme>` immediately.
- **Shared device, honest limit:** the preset is a device-level colour
  scheme, not an account setting, and it is not tied to a session. Two
  accounts on one device therefore see the last chosen preset. It
  carries no personal data. `clearThemeCookie()` exists so the
  sign-out path can drop it — wiring that call into sign-out is an open
  integration request (see the UI foundation handoff).


### 1.2 Accent — runtime token (tenant branding) and the preset action family

Two different things used to share one name. They are now separate:

**The tenant accent** is the academy's brand colour, chosen by the owner
from **six approved values. Never a colour picker.**

```
mango · marine · indigo · plum · forest · slate
```

It paints the **academy mark** (`components/branding/tenant-mark.tsx`
reads `lib/branding/accents.ts`). It is a branding token and nothing
else.

**The action family** (`--accent`, `--accent-soft`, `--accent-ink`,
`--accent-strong`) is owned by the **theme preset** (§1.1) and paints
the single primary action on a screen, the active nav state and the
focus ring:

```css
:root {                      /* Mint Garden */
  --accent:      #1F5E3A;   /* identity / active nav */
  --accent-soft: #DFEEE3;
  --accent-ink:  #0F3220;   /* accent text on a soft background */
  --accent-strong: #1F5E3A; /* the action surface (white text: 7.72:1) */
}
```

Use for: the single primary action on a screen, active nav state, focus rings.

Focus rings use a dedicated `--focus-ring` token, which **must meet WCAG 1.4.11 (≥3:1 contrast) against every control surface** — in Mint Garden that is `paper` `#FFFFFF` (7.72:1) and `deck` `#EDF0EC` (6.72:1); in Lavender Club it is `#FFFFFF` (9.91:1) and `#F6F3FB` (9.03:1). The token's value must remain a literal hex so `pnpm check:focus-contrast` can parse it; a CSS expression here (e.g. `color-mix(...)`) fails the check loudly rather than silently. The check reads the **default** preset's ring; the per-preset rings are asserted by `tests/foundation/theme-tokens.test.ts` (extending the script to read every preset is an open request).

**`--accent` may never appear inside a status or state style.** Enforced by lint. Semantic tokens are not derived from the accent and do not change with it.


### 1.3 Type

```js
fontFamily: {
  display: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
  sans:    ['Instrument Sans', 'system-ui', 'sans-serif'],
}
```

Static weight files, not variable — the variable axis pays for a weight
range (100–900, both families) nothing in the type scale below ever
renders. Shipped weights, latin subset only:

| Family | Weight | Role |
|---|---|---|
| Bricolage Grotesque | 600 | display only — nothing renders it at 400/500 |
| Instrument Sans | 400, 500 | body/emphasis |

Self-hosted, subset to Latin only (`latin-ext`/`vietnamese` dropped —
nothing in this product needs them today), `font-display: swap`.

**Combined budget 60 KB, latin only — actual 55.2 KB, inside budget.**
The three static latin files (`instrument-sans-latin-400`,
`instrument-sans-latin-500`, `bricolage-grotesque-latin-600`, woff2) are
16.5 + 16.8 + 21.9 KB. The original 45 KB figure was set before any
static-weight measurement existed — a guess, and wrong once real numbers
came in. Raised to 60 KB rather than compromise the type: the three
weights are load-bearing for the design, and against a 102 KB shared JS
baseline and a 150 KB total budget there's headroom to pay for it.
Enforced in CI as its own gate (`scripts/check-font-budget.ts`), same
shape as the JS bundle gate — adding a fourth weight or a new subset
fails the build, not a later "someone noticed."

**Phase 4 (Hindi, Bengali) will need revisiting this budget, not just
extending it.** Neither Bricolage Grotesque nor Instrument Sans ships a
Devanagari or Bengali subset at all (checked both packages' `metadata.json`
— `subsets: ['latin', 'latin-ext']` and `['latin', 'latin-ext', 'vietnamese']`
respectively) — Phase 4 is a new typeface decision, not a bigger latin
budget. Measured for real against Noto Sans Devanagari/Bengali (400+500+600,
each script's own subset, woff2) as a size anchor, not a guess: Devanagari
~154 KB, Bengali ~136 KB. Either alone is roughly 2.5–3x this entire latin
budget; loading both unconditionally for every user is not viable at any
budget. Phase 4 needs a decision on per-locale conditional loading (ship a
user's script, not everyone's), before it needs a bigger number.

| Role | Size | Family | Weight |
|---|---|---|---|
| Display figure | 32–38px | display | 600 |
| Page heading | 19–22px | display | 600 |
| Section heading | 15px | display | 600 |
| Body | 14–15px | sans | 400 |
| Body emphasis | 14–15px | sans | 500 |
| Label / meta | 12–13px | sans | 400 |
| Micro | 11px | sans | 500 |

**Weights 400, 500, 600 only.** Nothing bolder. Never below 11px.

```css
html { font-variant-numeric: tabular-nums; }
```

Global, not per-component. This is a money product; misaligned digits are the tell of amateur work.

### 1.4 Spacing, radii, elevation

Spacing: multiples of **4px** only.

```js
borderRadius: { card: '20px', ctl: '10px', pill: '9999px' }
boxShadow: {
  1: '0 1px 2px rgba(15,31,28,.05)',
  2: '0 2px 6px rgba(15,31,28,.05), 0 14px 32px rgba(15,31,28,.08)',
}
```

**Two shadow levels. Never a third.** Default to a `1px solid line` border instead — shadows read as 2016. Shadow 2 is for floating elements only (nav bar, sticky action bar, modals).

**Shared control metrics** live as tokens in `app/globals.css` so a
page never re-guesses them: `--control-height-sm` (44px), `--control-height-md`
(48px), `--control-height-lg` (52px), `--icon-size-sm/md/lg`
(16/18/20px), `--icon-stroke` (1.8) and `--icon-stroke-active` (2.2),
plus the layer order `--z-nav`, `--z-sticky`, `--z-overlay`, `--z-toast`.

### 1.4a The shared control contract (owner redesign, 27 October 2026)

The human approved ONE control system for both presets. It is a contract
about **rendered** geometry, not about class names:

- **Standard control — 48px high, 10px radius (`--radius-ctl`), 16px
  control text, 16px horizontal padding.** Action buttons, text fields,
  selects, date fields and time pickers are all standard controls.
- **Compact control — at least 44px high.** A table row action and a
  tertiary control keep the 44px floor; a shared button says so
  explicitly (`size="sm"`).
- **A standard button is the default.** `Button` and `buttonClasses()`
  default to the 48px standard, so an ordinary header, form or toolbar
  action is never 44px beside a 48px input. A compact action opts in.
- **A long action wraps and grows.** No action sets `whitespace-nowrap`,
  `truncate` or `overflow-hidden` to keep a numeric height.
- **Surfaces:** an ordinary entry or search field stays **neutral**; a
  **picker** (a select, a date or time field) wears a very lightly tinted
  picker surface; a **secondary** action button wears a slightly stronger
  theme tint; the **primary** action is the solid theme colour.
  Destructive, error and success keep their reserved tokens and always
  carry a word or an icon, so colour is never the only cue.
- **A toolbar aligns control bottoms.** Labels sit consistently above
  fields; no extra field margin changes the row alignment. Search gets
  useful flexible width, pickers have bounded widths, and a narrow
  screen wraps or stacks deliberately.

The tokens live in `app/globals.css` (`--control-text`,
`--control-padding-x`, `--control-border`, `--control-border-hover`,
`--control-surface`, `--control-surface-picker`, `--control-surface-action`,
`--control-surface-action-hover`). The tints are `color-mix()` expressions
over `--accent-strong`, so they follow the preset without being restated
per preset.

The rendered geometry is proved in Chrome by
`e2e/owner-redesign-c1-controls.ts`, which measures the computed height,
radius, font size and painted background of the real controls, in both
presets, at 390×844, 1280×900, 1280×600, 1023×768 and 1024×768 — and
also proves that the shell's controls share a bottom edge and that no
viewport gains a sideways scroll.

### 1.4b Subtle surfaces and purposeful placement (human direction, 28 October 2026)

The owner summary row is the reference for the product's quiet colour language.
Ops uses the same foundations and attention to detail, with desktop-first
density. This is a design requirement, **not a statement that every consumer
has been implemented or visually accepted**. Owner and Ops may use different
compositions for their tasks; they must not look like unrelated products.

**Summary surfaces.** Use the existing tokens below. Pastels group information
and aid scanning; the label, value, explanatory text and any status icon carry
the meaning. A coloured surface alone is never a status or an interaction cue.

| Context | Surface token / utility | Meaning and supporting treatment |
| --- | --- | --- |
| Collected money; active platform context | `--color-tile-money` / `bg-tile-money` | Calm mint. Owner collections use a wallet with `good` ink; Ops active tenants use an appropriate tenant icon, not a money icon. An active count is not a claim that every tenant is healthy. |
| People or general task information | `--color-tile-info` / `bg-tile-info` | Powder blue in Mint Garden, pale lilac in Lavender Club. Owner active members and Ops open tasks use their own meaningful labels/icons. An open-task count alone does not imply urgency. |
| Sessions or trial context | `--color-tile-butter` / `bg-tile-butter` | Restrained butter surface. A calendar identifies sessions; trial context has a suitable trial/time label. Yellow is not automatically a warning. |
| Confirmed overdue money or positive at-risk count | `--color-late-soft` / `bg-late-soft` | Soft red with `late` ink and an explicit overdue/risk label. Only use alarm treatment when the underlying condition exists. |
| Neutral, unavailable or inapplicable information | Existing `paper` / `deck` surface | Explain the state. Do not manufacture a number, a healthy status or a pastel category merely to fill a row. |

Owner reference order: **Collected today → Overdue → Active members → Sessions
today**. Respect the sport's existing member/session terminology. Ops Overview
order: **Active tenants → On trial → At risk → Open ops tasks**. These are
context assignments, not a rotating palette based on a tile's array index.
Keep each metric in the same position across theme changes and data refreshes.

- **Calm zero:** zero collected stays mint with honest zero-payment copy;
  zero overdue or zero at risk has a calm neutral/information treatment and
  explicit zero-state wording, not red alarm ink. Missing data stays distinct
  from zero. An absent Ops snapshot must not create four zero-valued cards.
- **Text:** dark readable ink on pale surfaces; `late` value ink only for a
  real problem. Keep numeric formatting and tabular numerals consistent.
  Labels are quieter than values; the short explanatory line is quieter than
  both. Do not shrink text or remove definitions to equalise card heights.
- **Icons:** when present, use a consistent 32px chip, 10px chip radius,
  18px icon and 8px icon-to-label gap. Use existing icon-size/stroke tokens and
  individual Lucide imports. Decorative icons are hidden from assistive
  technology; visible words retain the meaning. Use reserved `good`, `late`,
  `warn`, `water`, `marine` or neutral chip treatments for the actual context.
- **Geometry:** siblings share a radius, padding, label baseline and value
  rhythm. Owner `StatCard` retains its existing compact geometry; Ops may
  retain its larger display figure. Do not duplicate either component's
  styles on individual pages or stretch all panels to an arbitrary height.
  Owner keeps its 2×2 phone summary; Ops may stack metrics on a narrow screen
  to preserve readable labels and snapshot notes instead of shrinking them.
- **Interaction:** only a supported drill-down is a link. Carry the same
  period/location filters to its destination. A non-interactive metric has
  no pointer cursor, hover elevation or invented button affordance.

**Controls and their small differences.** Consume the shared primitives from
§1.4a, including ref, label, keyboard, pending and disabled behavior. The
existing surface derivations are deliberate: entry/search is neutral;
pickers mix 5% of `--accent-strong` into paper; secondary actions mix 10%
(16% on hover); primary actions use the solid action token. Use
`--control-surface-picker`, `--control-surface-action` and
`--control-surface-action-hover`, not local colour literals or copied mixes.
Selections, validation and destructive actions keep their own semantic tokens.
Do not tint a search field to make it look as important as the primary action.

**Placement and alignment.** Put the page title and context first, then the
relevant summaries, then the work that needs attention. Group filters with
the dataset they affect and actions with the task they complete. In a toolbar,
labels sit above their fields and the input/select/action control bottoms
align, even when an action has no label. Use one intended gap between groups;
do not render empty header/action slots that leave phantom gaps. Give search
the flexible width; keep short pickers bounded. Wrap related controls
together, then stack them on a phone rather than clipping labels, native date
segments, chevrons or buttons. Use the shared 4px spacing scale, not per-page
pixel nudges. Do not force an unlabelled button into a field-label row.

**Every state is designed.** Include populated, real zero, missing data,
filtered-empty, loading, error/retry, selected, disabled/pending and
permission-limited states where applicable. Keep the page's structure and
control geometry stable. A viewer's limit is stated in words; it is never
conveyed only by faded colour. Theme preference must not alter data, scope,
permissions or the meaning of a status. Preserve reduced-motion behavior.

**Finish gate for these details.** Inspect actual computed backgrounds, ink
contrast, icon geometry, field/button heights, label alignment and overflow
after hydration in **both presets**. Standard controls are 48px high with
16px text and 10px radius; compact actions explicitly retain the 44px floor.
Check Owner at 390×844 and 1280×900; check Ops at 1280×900 plus narrow reflow
at 390×844. Apply §2.1's extended matrix when shell/scroll behavior changes.
Verify text contrast (4.5:1 ordinary, 3:1 large) and applicable control/focus
contrast (3:1) on the actual tinted surfaces. Record functional acceptance
separately from visual acceptance; a class name or passing build is not proof
that the browser painted the right colour. Save measurable intended RED
before a visual implementation change, then GREEN and independent review.

### 1.5 Motion

150ms, on hover and press only. No entrance animations, no scroll effects, no stagger. Respect `prefers-reduced-motion` — disable all transitions under it.

**Motion primitives** (CSS first, no motion library —
`docs/design-system/motion.md`): `--motion-duration-fast` (120ms),
`--motion-duration-base` (150ms), `--motion-duration-slow` (200ms) and
`--motion-ease-standard`, exposed to components as the `motion-fast`,
`motion-base` and `motion-slow` utilities. The global
`prefers-reduced-motion: reduce` rule neutralises every transition and
animation, so a motion utility is never a promise the user cannot
decline.


---

## 2. Layout rules

- **Mobile-first, always.** Coaches use this one-handed while standing.
- Touch targets **44 × 44px minimum**.
- Inputs at **16px** font size — anything smaller triggers iOS zoom-on-focus.
- Bottom nav: **exactly four items**. There is no "More" tab. If a fifth thing seems necessary, something else is wrong.
- Role layouts are separate route groups, not conditional rendering. A worker's bundle must not contain owner components.
- **`/ops` is desktop-only (decision 2026-09-18; supersedes the Sep 2026 mobile-console amendment).** Operators work from laptops at **1280×900**: the sidebar, data tables and console type remain the primary experience. Mobile is not a supported target — no mobile console requirement, no mobile test gate; mobile rendering is best-effort only. Inputs at 16px still bind the console's list filters.
- **Owner is the only dual-surface role (decision 2026-09-18).** At `lg` (≥1024px) the owner gets a desktop shell — sidebar + top bar carrying the global record search, content capped at **1280px**; below that breakpoint the same four-item bottom nav is preserved and the record search stays in the same top bar (it is never a fifth nav item). The facility switcher ships in the shell, and renders only for tenants with more than one location. A notifications affordance is **not** built: there is no notification data, and a bell with a fabricated count is forbidden (§7). Coach and reception remain mobile-only (390×844); the parent stays the zero-JS token link.
- **No dark mode.** Users are outdoors in daylight. High-contrast light wins.

### 2.1 Shell scroll ownership (foundation, 2026-10-26)

The shell states who scrolls, so no surface ends up with two scrollbars
or with its navigation scrolled out of reach:

- **One main vertical scroll owner: the document.** The owner content
  column is **not** a second scroller. An inner scroller would silently
  break the router's scroll-to-top on navigation, browser Back, and
  anchor links.
- **The desktop sidebar is viewport-bound and sticky**
  (`lg:sticky lg:top-0 lg:h-dvh lg:overflow-hidden`, inside a row laid
  out with `lg:items-start`). It stays visible while the page scrolls
  and never grows past the viewport.
- **Only the navigation region scrolls inside the sidebar**
  (`min-h-0 flex-1 overflow-y-auto overscroll-contain`). On a short
  screen the menu scrolls on its own while the branding and the exit
  control stay reachable without scrolling.
- **The header is sticky**, so the record search stays available during
  long-page scrolling.
- **Tables scroll sideways inside their own region**
  (`components/ui/DataTable.tsx` wraps the table in `overflow-x-auto`),
  so the page never gains a horizontal scrollbar.

Verify at 1280×900, 1024×768, 1023×768 (one pixel below the
breakpoint), 1280×600 (short) and 390×844.

Verify actual browser 200% zoom and record native window/content
dimensions. A 640×450 reflow proxy may supplement the check, but cannot
certify browser zoom. Device scale factor and pinch zoom are not
substitutes.


---

## 3. Component patterns

### The lane strip — signature element

Reused across three surfaces with three meanings: owner sees batch capacity, coach sees progress through the register, parent sees membership runway.

```jsx
<div className="mb-3">
    <div className="flex justify-between text-[13px] mb-2">
    <span>07:00 Beginners</span>
    <span className="text-ink-3">14 / 16</span>
  </div>
  <div className="h-1.5 rounded-full bg-deck overflow-hidden">
    <div className="h-full rounded-full bg-water" style={{ width: '87%' }} />
  </div>
</div>
```

Fill colour: `water` normally, `warn` when under-filled, `late` when a problem.

### Status pill

```jsx
<span className="text-[11px] font-medium px-3 py-1 rounded-pill bg-good-soft text-good">
  Paid
</span>
```

**Always carries a word or icon, never colour alone** — accessibility requirement and it survives sunlight.

Shipped as `components/ui/StatusBadge.tsx` (2026-09-13 UI/UX audit §7.1). Tones map 1:1 to the semantic tokens plus a neutral pair for terminal states. Lifecycle maps shipped with it: `MEMBER_STATUS_TONE`, `ENQUIRY_STAGE_TONE`, `TENANT_STATUS_TONE`. Any new lifecycle field uses one of those (or adds a map entry) rather than a one-off pill.

### List conventions (audited 2026-09-13 §7.4 — two tiers, both deliberate)

- **Row-card** (bordered, `rounded-card`, `bg-paper`, one row per card): short, curated lists — dashboard "Needs you today", settings hub, staff list. The card makes each row feel like a destination.
- **Divided list** (one container, `divide-y`/`border-b` on `line`, no per-row radius): long, dense lists — members, enquiries, register. Card-per-row over dozens of rows is noise and pushes the page into unreadable scroll.

Rule of thumb: **≤ ~10 curated items → row-card; more or working lists → divided list.** Both use the same type scale and status treatment; only the chrome differs.

### Button

`components/ui/Button.tsx` (2026-09-13 audit §7.2). Variants: `primary`
(the single accent action), `secondary`, `ghost`, and `destructive` (the
`late` token — hard-to-reverse actions like "Mark churned"). Never
hand-roll a height below 44px.

Sizes (the shared control contract, §1.4a): **`md` is the default** — the
48px standard control, 16px control text and the 10px control radius.
`lg` is the standard with more padding. `sm` is the explicit **compact**
control: 44px, for a table row action or a tertiary control. A caller
that says nothing gets the standard.

Every shared button carries `data-control="button"`, so a check can find
a shared button without guessing at its classes.

### Foundation primitives (foundation lane, 2026-10-26)

The foundation owns the primitives below. They are copied-source
shadcn-style wrappers (`components.json` records the configuration) with
**no component library dependency**: native HTML carries the behaviour
where it already does it well (a native `<select>` on a phone, a native
`<dialog>` with `showModal()` for the focus trap and Escape, a native
`<input type="checkbox">`), and the three shadcn helpers
(`class-variance-authority`, `clsx`, `tailwind-merge`) are used for
typed variants and class merging. Adding a UI *library* (MUI and
friends) is still forbidden.

| Primitive | File | Notes |
|---|---|---|
| Button | `components/ui/Button.tsx` | existed; the API is unchanged — the standard control is now the default (§1.4a) |
| Status badge | `components/ui/StatusBadge.tsx` | existed; owns the tone maps (§3 status pill) |
| Table / list row | `components/ui/DataTable.tsx`, `Row.tsx` | existed |
| Empty state / error | `components/ui/EmptyState.tsx`, `FieldError.tsx` | existed |
| Section header | `components/ui/SectionHeader.tsx` | existed |
| Skeleton | `components/skeleton.tsx` | existed |
| Input / Textarea | `components/ui/Input.tsx`, `Textarea.tsx` | the standard control: 16px text, 48px height, 10px radius, neutral entry surface (§1.4a); `invalid` → `aria-invalid` |
| Label / Field | `components/ui/Label.tsx`, `Field.tsx` | one field shape: label, description, control, error beside the control |
| Select | `components/ui/Select.tsx` | native select, decorative chevron; a picker surface |
| Date field | `components/ui/DateField.tsx` | the masked day-first date picker; a picker surface |
| Checkbox / Switch | `components/ui/Checkbox.tsx`, `Switch.tsx` | native checkbox; switch is `role="switch"` with `aria-checked` |
| Tabs | `components/ui/Tabs.tsx` | in-page tabs with roving tabindex; URL-state tabs stay links (`SegmentedTabs.tsx`) |
| Dialog | `components/ui/Dialog.tsx` | native `<dialog>`, focus returns to the trigger |
| Menu | `components/ui/Menu.tsx` | dropdown menu, Escape and arrow keys |
| Toast / inline feedback | `components/ui/Toast.tsx`, `InlineFeedback.tsx` | polite live region; neutral styling (never a status colour) |
| Pagination | `components/ui/Pagination.tsx` | states the page, disables at the ends |
| Card / section | `components/ui/Card.tsx` | one radius, one border, one padding scale |
| Badge | `components/ui/Badge.tsx` | neutral label — lifecycle state belongs to `StatusBadge` |

Every primitive documents its states: populated, empty, loading, error,
disabled/pending, long text and mobile behaviour. The **component
fixture** (`components/ui/fixture/component-fixture.tsx`) shows all of
them with synthetic data and is rendered by a test — it is never
mounted on a public route.

Pages consume these by name. A page task does not change a primitive's
API unilaterally; a change to a primitive is a foundation change.


### Primary action

```jsx
<button className="w-full rounded-pill py-4 text-[14.5px] font-medium
                   text-white bg-[var(--accent-strong)] transition-colors duration-150">
  Send reminders on WhatsApp
</button>
```

One primary action per screen. Everything else is secondary or a plain link.

### Action hierarchy

Purpose: tell the reader what the screen is *for* without a row of equal
buttons. **One dominant action** — accent-filled, standard 48px (§1.4a), the only one on the
screen. Everything else is **secondary** (quiet bordered control or plain
link) or **tertiary** (plain link, muted). A destructive action never sits
beside the dominant one as an equal.

A shortcut's label must match what the destination can actually complete. "Record
payment" pointing at a payments *history* list is a lie; point it at the real
collection journey (an invoice that can be settled) or rename it. Owner Home:
**Collect payment** → Fees → Dues (open an invoice → record payment); Add
swimmer and Capture enquiry are quiet secondary/tertiary links.

### Summary metric

Purpose: answer one standing question at a glance and lead to its evidence.
Use: four (never more than five) tiles in one row on desktop, 2×2 on an owner
phone. Ops may stack at narrow widths as specified in §1.4b.
Apply §1.4b's subtle surfaces, icon treatment, calm-zero rules and consistent
geometry; plain white tiles are not the default substitute for that direction.
Every tile carries:

1. a label that states its **basis** — "today", a **current balance**, or a
   plain count; never a figure whose period the reader has to guess;
2. the value, in compact money (`formatINRCompact`) or a count;
3. one short definition/detail line (invoice count, payment count, what is
   included);
4. a drill-down that keeps the filters the figure was computed under
   (facility, date period).

**Unavailable is not zero.** A figure that could not be read is "—" with the
reason; a real zero says so in words ("No payments recorded today yet",
"Nothing past due"). A tile with no supported destination is not a link.

### Attention row

Purpose: one thing that needs a human decision. Each row states **what**,
**why now** (the age — "due 3 days ago", "oldest 18 days late", "started 40
minutes ago") and **where to act** (a destination that resolves it). A count
alone is not a row.

At most **three** rows occupy a screen; a count chip states the true total and
the remainder stays one disclosure away ("N more need attention"). Do **not**
add a "View all" link unless a real page lists all of those items — and never
build that page just to justify the link. Empty queue = one quiet sentence, no
illustration, no badge.

### Schedule row

Purpose: read the day in time order. A row carries time, name, programme,
**who is taking it** (coach, or "no coach assigned"), occupancy
(enrolled/capacity with the lane strip) and **register state**. Register state
is **completion** — marks recorded out of the distinct swimmers expected —
and is always worded as such ("Register complete — 12 of 12 marked"). It is
never labelled attendance, and a percentage is not shown for it.
**Occupancy over capacity is its own warning**: the counts turn `late`, the
bar turns `late`, and a line states "Over capacity by N — X enrolled against
Y places". It is not attendance and not register completion, so it never
borrows their wording or colour. Attendance
(present or late ÷ eligible marks) belongs to reports and the attendance
trend only. A quiet day names the next scheduled class instead of an empty
block.

### Working table

Purpose: compare many records, not read paragraphs. At `lg+` use aligned
columns with money right-aligned and stable row height; the identity column is
the row destination, status is a pill, secondary dates stay quiet. Below `lg`
transform to two-line rows (identity + status first, supporting metadata
second) rather than compressing columns or scrolling horizontally for
essential fields. A list that exists to be scanned is a **divided list**
(§3 list conventions), not a card per row.

### Bounded editor

Purpose: create or change one record without losing the page behind it. Cap
the form's measure (~640px), label every field above the input, keep inputs at
16px, put validation beside the field and keep entered values on failure. A
sticky save bar reserves its own space so it never covers the last field or
the consent block. Cancel returns to the record; saving is never a cosmetic
button on an auto-saving surface (the register saves as it marks).

### Tabs and filters

Purpose: narrow one dataset without losing context. Tabs are **URL state**
(`?tab=`, `?trend=`, `?facility=`), server-rendered, so a shared link opens the
same view and Back does the expected thing. Switching keeps the scope
(facility, period) and every count/empty state describes the filtered set, not
the unfiltered one. Label the period actually rendered ("Last 30 days",
`22 Aug – 20 Sep`), never a rolling window called "this month".

### Account controls

Purpose: identity and session, available from every owner screen. The account
menu (name/role when known, sign out) is a compact control in the identity
header, never a full-width button in the content area; sign-out must also be
reachable from the shell for roles without Settings. The academy mark is
branding, not a person avatar.

### Charts

Purpose: answer one stated business question over one stated period. At most
**one chart panel** per screen. Each chart states:

1. the **question/metric** in its heading or summary line ("Attendance —
   percentage present or late, last 30 days");
2. the **units** (%, ₹) — axes and labels, not implied;
3. the **period** as a human range, with the exclusive upper bound converted;
4. an **accessible summary** in the `aria-label` (what is measured, units,
   period, how many points) plus a visible one-line summary;
5. its **drill-through**, carrying the same period and facility scope.

Owner Home is the approved exception to "one panel": it carries **two** —
one wide metric panel (Collections / Attendance, one at a time) and one
compact composition chart (payment mix). Anywhere else: one chart panel.

Engine and loading: **Apache ECharts, modular imports only**
(`echarts/core` + the chart/component modules actually used), mounted as a
lazy `lg+` island. Below `lg` the same panel renders its accessible data
table instead, so a phone never downloads the engine (§5). Respect
`prefers-reduced-motion`: no animation, no entrance.

**Series colours** come from the preset's chart tokens (`--chart-1` …
`--chart-5`): one colour per series, distinct inside a chart, readable on
the preset's canvas. A chart never invents a colour of its own, and a
series colour never carries meaning on its own — the legend and the data
table do that.

Every chart also provides: readable axis labels and INR values (compact on
axes, exact in the table/tooltip); one consistent colour per category;
a keyboard-reachable **View data table** with the same numbers; a stated
no-data state ("No payments recorded in this period", "No marks recorded —
unknown, not zero") and a stated unavailable state when the read fails.
Never draw an empty frame.

A metric switch and a period switch are URL state and show one chart at a
time. Never render an empty chart frame: a metric without data is one honest
sentence. If no metric in the panel has data, the panel is not rendered at
all. Colour here is data (§1.1), never decoration.

**Stacked categories** (e.g. payment groups) state what each colour means in
a label, keep "Other" as its own category (never folded into Digital), and
link each category to the filtered records it was computed from — only when
that filter really exists. **Comparison** text sits beside the chart, never
as an overlaid second series: state the metric, the current and previous
exact ranges (IST), the change, and "No previous collections in the
comparison range" when the previous range was empty — never an infinite
growth figure.

### Empty state — built with the list, never after

Every list is designed together with its empty state; an empty block with no
words is a bug. The empty state names the state ("No members yet"), says what
is true ("Nothing scheduled today; next: Morning Squad, Mon 26 Oct"), and
offers the verb that changes it. Charts are not lists (see Charts above): an
empty metric is one sentence, not an empty frame.

```jsx
<div className="text-center py-12">
  <p className="text-[15px] font-medium">No members yet</p>
  <p className="text-[13px] text-ink-3 mt-2">
    Import from a spreadsheet, or add your first member.
  </p>
  <button className="mt-5 …">Import members</button>
</div>
```

Every list has one. Every empty state has a verb CTA. The first screen a new academy sees is empty — competitors leave it blank, and it's their worst moment.

### Loading

**Skeletons, never spinners.** Users are on flaky poolside 4G; a spinner reads as broken.

```jsx
<div className="h-4 w-32 rounded bg-deck animate-pulse" />
```

### Insufficient history

A trend, retention figure or rate needs enough eligible history to mean
anything. When the cohort or window is too small, say so ("Not enough
attendance history") and do not compute a risk count from it — a derived
figure from two marks is a claim the data cannot support. Null is not 0%: a
rate with no eligible marks is "—" or "no marks yet".

### Error

A failed read is neither empty nor zero. Keep the surrounding page, say which
block could not be read, and put the retry next to it. Entered values survive
a failed save; a request that may have partially succeeded says so ("check
before retrying") rather than inviting a double submit.

---

## 4. Writing

- **Sentence case everywhere.** Never Title Case.
- Currency: `₹18,200` — grouped Indian-style, no decimals unless paise are meaningful. Exact money (`formatINR`) prints paise for receipts, ledgers and anything that round-trips through `parsePaise`; summary figures use `formatINRCompact`, which drops a trailing `.00` and nothing else. Both are display-only: arithmetic stays integer paise.
- Dates: `22 Aug`, `Sat 22 Aug`. Never `08/22`.
- Every attention item states **why it's there**: "3 trial enquiries — no follow-up in 2 days," not "3 enquiries."
- Errors say what to do next, not what failed.
- Never hard-code vocabulary. Use `term(ctx, 'member', 'other')` — the tenant may call them swimmers, players or students.

---

## 5. Performance

| Metric | Limit |
|---|---|
| First-load JS, gzipped | **150 KB** — build fails above |
| Fonts | 60 KB (latin subset, woff2; see §1.3) |
| LCP, 4G mid-tier Android | 2.5s |
| Lighthouse mobile | > 90 |

Rules that keep it there:

- Server Components by default. Client islands only: attendance marker, booking calendar, POS keypad, charts.
- Icons: individual icon paths, **never** a package-barrel sample. Check the installed module/type declarations before introducing a new icon; bundle measurement decides the shipped cost.
- No chart library on any mobile route. Server-render SVG or lazy-load behind interaction.
- No component library. shadcn/ui copied source only.
- Images through `next/image` with explicit dimensions.

**The foundation's own dependencies** (2026-10-26): `clsx` 2.1.1,
`tailwind-merge` 3.7.0 and `class-variance-authority` 0.7.1 — the three
helpers a copied shadcn source needs, about **7 KB gzipped** together,
and only on routes that import a foundation primitive. They are the
*only* new runtime dependencies this program adds; the primitives
themselves add no component library. `pnpm check:bundle` is the
authority on the per-route cost.


---

## 6. Never

| Never | Why |
|---|---|
| A raw hex value in a component | Tokens are the system |
| `--accent` in a status or state style | Destroys the colour thesis |
| Two vertical scroll owners on one surface | Double scrollbars; the reader loses the page |
| A theme preset used for anything but colour | A display preference is not an authorization input |
| A third shadow level | Two is the system |
| Font weight 700+ | Not in the scale |
| Title Case | |
| A "More" nav tab | Where features go to die |
| Colour as the only carrier of meaning | Accessibility, and sunlight |
| Spinners | Read as broken on slow connections |
| Emoji as icons | Render differently on every Android skin |
| A component library | 300 KB for what shadcn does for free |
| Barrel imports from `lucide-react` | Silent bundle bloat |
| Decorative illustration or stock art | 200–400 KB each. Personality comes from type and shape |
| Dark mode | Deferred product-wide |
| Gradients | Not in the system |
| A list without a designed empty state | The first thing every new tenant sees |
| Two dominant actions on one screen | The reader cannot tell what the screen is for |
| A shortcut whose label the destination cannot honour | A dead end that reads as a capability |
| A fabricated notification count, growth delta or target ring | Invents data the academy does not have |
| An unavailable figure rendered as zero | A failed read is not a fact |
| An empty chart frame | Reads as broken data, not as "nothing yet" |

---

## 7. Owner Home — composition contract (shipped 2026-10-25)

`/owner` is the owner's daily oversight workspace. The owner reviews; they do
not mark registers or run the front desk from this screen. The screen answers,
in order: what day/scope is this, what happened, what is owed, what needs me,
what is on today, and (optionally) one trend.

### Composition

**Desktop (≥1024px, content capped at 1280px):**

1. **Identity header** — academy mark and name, the scoped location (or "All
   locations" for a multi-site tenant when unscoped), the **full date**
   ("Sun, 25 Oct 2026"), and the account menu. The record search stays in the
   shell top bar; it is never duplicated in the page.
2. **Summary row** — four `StatCard` tiles: `Collected today` (today's gross
   captured payments + count, drills to that day's transactions with the
   facility kept), `Overdue` (current past-due balance; detail states invoice
   count, oldest age and the outstanding total, drills to Dues), `Active
   <members>` (count + running batch count), `<Sessions> today` (count +
   enrolled total, or "Nothing scheduled today", drills to Schedule).
3. **Actions** — exactly one dominant shortcut: **Collect payment** (accent),
   only when `payments.record` is held, linking to
   `/owner/fees?tab=dues` — the Dues list where an invoice is opened and the
   payment recorded. Secondary/tertiary: **Add <member>**, **Capture
   <enquiry>** as quiet links. No action is rendered without the permission
   its destination enforces.
4. **60/40 split** (`lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]`,
   `items-start` so unequal heights do not stretch cards):
   - **Today** (60%) — one card of divided class rows: time, batch,
     programme, coach (or "no <coach> assigned"), occupancy bar
     (enrolled/capacity) and **register state** (completion, worded as marks
     recorded). Header states `N of M marked across K sessions`. Quiet day
     names the next class with coach, date, time and occupancy.
   - **Needs you today** (40%) — at most three `AttentionRow`s (reason + age
     + destination), the true total in a count chip, the remainder one
     disclosure away. No "View all" unless a real list exists. Empty queue is
     one quiet sentence; the onboarding hint appears only for a genuinely new
     academy (no checklist step complete).
5. **Chart band** — a wide **Trends** panel (`Collections` stacked bars by
   payment group / `Attendance` line) beside a compact **Payment mix**
   doughnut. Metric and period are URL state (`?trend=`, `?period=`,
   facility preserved). The doughnut's centre states the selected period's
   captured total; its HTML legend lists Cash / Digital / Other with amount
   and percentage, expands Digital into UPI / bank transfer / card, and
   links each category to `/owner/fees?tab=transactions` filtered by
   `group=`/`method=` for the same dates and facility. Reversals are stated
   beside the total (ledger-only, not netted). The approved composition
   puts the **donut and the legend side by side**, and they wrap
   deliberately on a narrow screen rather than forcing a sideways scroll.
   Every legend row carries a colour swatch that REPEATS the meaning; the
   words carry it, so colour is never the only cue.
6. **By <facilities>** — only when the tenant has more than one location.

**Mobile (390×844):** header → dominant action → summary (2×2) → exceptions →
today's classes → trend → phone quick links (Fees & payments, Enquiries,
Programs & batches, Staff, Onboarding for a new academy). The four-item bottom
nav is unchanged, the footer clears the safe area, and no row scrolls
horizontally.

### Period controls and comparisons

Day / Week / Month (friendly labels). Every comparison is **same elapsed
local time**, in Asia/Kolkata:

| Key | Label | Compares |
|---|---|---|
| `day` | Day | today 00:00 → now vs yesterday 00:00 → the same wall-clock time |
| `week` | Week | this Monday 00:00 → now vs last Monday 00:00 → the same elapsed span |
| `month` | Month | 1st 00:00 → now vs previous month 1st 00:00 → the same elapsed span, **capped at the previous month's real end** |

Show `DoD` / `WoW` / `MoM` with a plain-language meaning (title/tooltip) and
the **exact both ranges**, e.g. "vs Sun 25 Oct 2026, 12:00 am – 2:35 pm
(Asia/Kolkata)". A capped month says so and names the capped date. Empty
previous range = "No previous collections in the comparison range" — never
∞%. The doughnut always depicts the **current** selected period; the
comparison is adjacent text, never a second overlaid ring. Totals must
reconcile with the recorded transactions under the existing money rules
(captured payments; reversals ledger-only), and attendance is present/late
over marks recorded — unmarked is unknown, not 0%.

### Approved exceptions (deliberate deviations from the Oct 2026 boards)

- **No growth deltas** ("+12%") on any summary metric: there is no comparable
  prior period in the data model, and the boards' deltas were illustrative.
- **No target ring** ("78% of ₹5,50,000"): no collection target exists.
- **No weather, no notification bell/count, no activity feed**: none is a
  supported read. The account control replaces the avatar menu; the shell's
  record search replaces the board's search field.
- **No separate capacity panel**: the class rows already carry
  enrolled/capacity, and duplicating the same evidence wastes the column.
- **No "View all" on the attention queue**: no page lists every exception;
  the disclosure keeps them reachable instead.
- **Money is shown compact on Home** (`₹57,000`, not `₹57,000.00`); receipts
  and ledgers keep exact paise.
- The left column leads with the day's classes, not a chart: the chart band is
  supporting evidence (§3 Charts).
- **Two chart panels on Home** (wide metric panel + payment mix): the single
  approved exception to the one-panel rule, because the mix answers a
  different question (composition) from the trend (movement).
- **No target ring / growth delta**: comparisons are real day/week/month
  elapsed-time changes only, and never shown when the previous range was
  empty.
- **Programs capacity chart deferred**: Home's schedule rows already carry
  occupancy and over-capacity warnings; a second capacity chart on Programs
  would repeat the same evidence. Data exists; the duplication does not add
  value.
- **Reports new members / renewals: not built** — `members.joined_on` is a
  reliable creation date, but "renewals" has no event/definition in the
  schema (subscription rows are not renewal events), so a renewal series
  would be invented. Reported as a data gap.

### Lavender Club — Option B (human approved, 27 October 2026)

The human approved a specific Owner Home composition and palette. This
amendment supersedes the "design pending" note for the OWNER HOME and
the OWNER SHELL only. Every other rule in this file — the security,
budget, accessibility and truthfulness rules above — still stands.

- **Palette.** Lavender Club is now **Option B**: a pale lilac canvas
  (`#F8F7FC`) and sidebar (`#EFEBF7`), a plum action family
  (`#634889`) and an aubergine ink (`#292136`). The muted ink is
  `#6B5A85` — one shade darker than the board's `#756C83`, which lands
  at 4.23:1 on the pale lilac sidebar and would fail AA.
- **One markup, two presets.** The owner home and the owner shell never
  branch on the preset. The difference is carried by the token layer:
  the shared semantic layer (`--surface-*`, `--text-*`, `--border-*`,
  `--action-*`) is declared once and follows the base palette, and
  every token whose VALUE differs per preset (`--selected-*`,
  `--surface-featured`, `--surface-attention*`, `--chart-*`,
  `--illustration-*`) is declared in BOTH presets.
- **The sidebar** carries the product mark and the academy above the
  navigation, and the account row and the exit control below it, so all
  three stay reachable when the navigation is taller than a short
  screen. The selected row is the preset's selection pill, not a
  hard-coded white card.
- **The header** is a compact 56px sticky row: a breadcrumb derived
  from the same navigation list the sidebar renders, the record search
  and the appearance control.
- **Owner Home composition.** The rest of §7 stands, with these
  changes:
  1. the screen opens with the **day, the academy and the location the
     figures cover**, with a small piece of club artwork beside the
     heading;
  2. **four figures on a desktop**; on a phone the two money figures
     stay as cards and the member and session counts collapse into one
     compact line;
  3. one dominant action (collect a payment) and quiet secondary
     actions — unchanged;
  4. the day's sessions are a **timeline** with the real occupancy and
     a truthful current/next distinction (a session is only called
     "in progress" when the register says so). The attention queue is
     beside it: every item stays reachable, and a money-late item is
     never the one folded away behind a disclosure;
  5. **"Money at a glance"** — the collections panel and the payment mix
     on ONE shared Day/Week/Month control placed above both panels, so
     the two always describe the same period;
  6. the insights preview — unchanged.
- **The artwork** is original SVG drawn from the semantic illustration
  tokens. It is chosen from the club's OWN programme names (never from
  a list the product does not have), it is stable for the visit, it is
  static first (no idle loop) and a reduced-motion reader sees a still
  picture.
- **The product name stays "Aqua".** The approved board used a working
  brand; renaming the product — and with it the cookies, env vars, PWA
  ids and deploy infrastructure — is a coordinated decision outside
  this work.

### Owner shell navigation (27 October 2026)

The desktop sidebar's **Scheduling** group carries the **booking desk**
(`/owner/bookings`) beside Programs & batches, Sessions and Schedule.

- The entry appears only for a caller who holds the **`bookings.read`
  permission** AND whose tenant is entitled to the **`pool.booking`
  feature** — the same two gates the bookings route itself enforces, so
  the sidebar never offers a destination that answers 404.
- When the caller's permissions removed the whole Scheduling group, the
  group is created with the booking desk in it, in the canonical order of
  the groups that are present. The booking desk is never offered twice.
- The **mobile bottom nav keeps exactly four items** (DESIGN.md §2). The
  phone reaches the booking desk through Settings — *Programs &
  facilities → Bookings* and *Fees & payments → Booking prices* — which
  the Settings page owns.

A hidden link is not a security control: the route and its actions stay
authoritative.

### Verification criteria

- 1280×900 and 390×844 with the seeded owner, plus one intermediate width
  (1024×768). Check populated and quiet-day states; the quiet day must name
  the next class, not show an empty block.
- Five-second questions: what needs attention and why; what is owed and since
  when; what is on today and who is taking it.
- Every drill-down keeps the facility (and period) the figure was computed
  under; "Collect payment" reaches an invoice that can be settled.
- Register state is never labelled attendance; unavailable is never zero;
  over-capacity occupancy is a separate late-toned warning.
- Day / Week / Month comparisons use the exact elapsed-time ranges above,
  cap a short previous month, and print "No previous collections" instead of
  a percentage when the previous range was empty.
- Every chart has a data table, INR labels, category colours and links that
  land on truly filtered records (group/method filters on Fees).
- Counts and money exact against the service reads; no horizontal overflow on
  the phone; touch targets ≥44px; inputs 16px (where any exist).
- `pnpm typecheck`, `pnpm lint`, tests, `pnpm build`, `pnpm check:bundle`,
  `pnpm check:fonts` pass; browser evidence saved with the branch.
