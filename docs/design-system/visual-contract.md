# Visual and component contract

## Layout and tokens

Reuse Bricolage Grotesque display and Instrument Sans body unless a measured,
human-approved typography change is needed. Tabular numerals for money/counts.
Maintain existing 60KB font and 150KB first-load per-route budgets.

Use semantic CSS variables in one foundation layer: canvas, surface, elevated,
text-primary/secondary, border, primary/foreground, focus, selected, chart series
and status pairs. Mint uses warm white/pale mint with deep forest actions and
restrained butter/powder-blue accents. Lavender uses white/pale lilac with violet
actions and dark aubergine text; desktop may retain the approved deep-purple
sidebar. Pastels are surface colors, not low-contrast text. Semantic status meaning
must not change with theme; charts need visible labels and distinct series.
Theme choice must validate an enum, avoid first-paint flash and remain independent
of authorization/tenant branding. Inspect existing preference storage; do not
add a DB table simply to save two color presets. Never leak a prior account's
personal settings on a shared device. Keep parent pages free of theme JS.

Spacing uses a small shared scale (4/8/12/16/24/32), deliberate control/card radii,
44px minimum touch targets, 16px form inputs and WCAG AA text contrast. Define
shared control heights, icon sizes/strokes, z-index and elevation tokens rather
than per-page guesses. Dense working rows stay readable on mobile.

## Shell

- Desktop sidebar remains visible while main content scrolls. Overflowing nav
  scrolls independently, with branding/account reachable; header/search stays
  available. No accidental body+main double scroll or global horizontal scroll.
- Mobile four-item navigation and safe areas remain. Full pages for long forms;
  sheets for short contextual tasks only. Keyboard and sticky bars must not cover
  errors, focused inputs or final actions. Tablet gets deliberate composition.
- Shared widths/gutters/heading baselines across Members, Fees, Programs and
  Settings. Forms have a readable max-width; tables may use local sideways scroll.
- Check 390×844, 1280×900, 1024×768, short1280×600, breakpoint±1 and 200% zoom for
  shell work. Test long Members top/middle/bottom with real geometry assertions.

## Component inventory and ownership

Foundation owns tokens/themes, Button, Input, Textarea, Select/Combobox, Checkbox,
Radio/Switch, Field/Error, Tabs, Badge/Status, Card/Section, Dialog/Sheet,
Dropdown/Menu, Toast/InlineFeedback, Skeleton/Empty/Error, Pagination and shared
Table/ListRow adapters. Inventory existing equivalents and migrate incrementally.
Use shadcn source as a base for behavior/accessibility, not a second parallel kit.
No page-local copies or mixed MUI/shadcn component systems. Native semantic HTML
remains preferable when it already meets the interaction requirement.

Each primitive documents purpose, variants, keyboard/focus, disabled/pending,
error/success, long text and mobile behavior. Build a local component fixture
route or test fixture with synthetic data; do not expose a debug gallery publicly.
Page tasks consume named wrappers and cannot change their APIs unilaterally.

## Home and charts

Task-first: identity/location/date, summaries, one dominant collection action,
next/today sessions and a short actionable attention queue. Keep the wide
Collections/Attendance tabbed panel plus Payment mix on desktop; on mobile show
readable charts with detail/progressive disclosure rather than hiding them solely
for budget convenience. Initial chart load can be deferred behind viewport or
explicit interaction; measure its dynamic cost, don't bundle it into the shell.

Attendance by batch and enquiries by current stage are the selected additional
insights (chart-gallery02 and05). Put detailed views in Reports/Enquiries with
compact entry points from Home; never six full charts stacked by default.

Cash/Digital/Other and per-method drill-downs must reconcile. IST Day/Week/Month
comparison semantics remain. Unmarked attendance is unknown; register completion
is separate. Current enquiry-stage counts are not historical step conversion.
Capacity/overcapacity remains visible and distinct from attendance. No invented
profit, churn, renewal events, fake growth or cosmetic data filling.
