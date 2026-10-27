# Component usage — what a page task may consume

Lane: **Screen contracts** (`design/screen-contracts`), 26 October 2026).
Companion to [screens.md](screens.md) and [flows.md](flows.md).

## Rules

1. **Consume a named wrapper; do not re-implement one.** A page that needs a
   button uses the shared Button. A page that needs a status pill uses the
   shared StatusBadge. A page that needs a card header uses the shared
   SectionHeader.
2. **No page-local copies.** A second implementation of a shared primitive is
   a defect, not a local choice.
3. **One component system.** The selected shadcn/ui copied-source primitives
   are the base for behaviour and accessibility; the Aqua domain wrappers stay
   as they are. There is no second kit and no bulk CLI scaffolding over the
   existing files.
4. **A page task may not change a shared primitive's API unilaterally.** It
   raises a change request to the foundation lane; the foundation lane keeps
   the API stable and extends it.
5. **Native semantic HTML wins.** When a native element already does the job
   (a link, a table, a fieldset), it is used rather than a div with a role.
6. **Tokens only.** No raw colour value in a component; the accent is an
   action and identity colour, never a status colour.

## Shared primitives under components/ui

These exist today. Their APIs are stable; a page task consumes them.

### `components/ui/Button.tsx`

- **Purpose:** the single button primitive. It exists because one member
  detail screen once had five buttons at five different heights, three below
  the 44px floor.
- **Variants:** `primary` (the one accent action on a screen), `secondary`,
  `ghost`, `destructive` (the `late` token, for hard-to-reverse actions).
  Sizes: `sm` is exactly 44px, `md` and `lg` are 48px. A `pill` option
  rounds it fully.
- **Keyboard and focus:** a real `<button>`; the focus ring comes from the
  global focus-visible rule and is never hidden.
- **Disabled and pending:** disabled buttons are dimmed. A pending save
  disables the control *and* keeps the page usable; a control is never
  blocked while an animation runs.
- **Error and success:** a button does not carry the message; the message
  belongs in the inline feedback next to the field.
- **Long text:** the label wraps; it never shrinks below 13px.
- **Mobile:** `sm` is the default because 44px is the touch-target floor.

### `components/ui/StatCard.tsx`

- **Purpose:** a summary figure that answers one standing question and leads
  to its evidence.
- **Props:** `label`, `value`, `hint`, an optional `delta` (direction plus
  plain-language text) and an optional `href`. A card with no destination is
  not a link.
- **Rules:** the label states its basis ("today", a current balance, a plain
  count); at most four on a row on desktop and 2×2 on a phone. A figure that
  could not be read is `—` with the reason, never a zero. A growth delta is
  shown only when a real comparable period exists.
- **Mobile:** the value stays on one line; the hint wraps under it.

### `components/ui/AttentionRow.tsx`

- **Purpose:** one thing that needs a human decision.
- **Props:** `title` (what), `detail` (why now — the age), an optional `href`
  (where to act), an optional icon and a `tone` of `warn` or `late`.
- **Rules:** a count alone is not a row. At most three rows on a screen; the
  true total lives in a count chip and the rest stays one disclosure away.
  No "View all" unless a real list exists.
- **Mobile:** the row is a single tap target of at least 44px; the text
  truncates in the middle rather than pushing the affordance off-screen.

### `components/ui/LaneStrip.tsx`

- **Purpose:** the signature element. It carries three different meanings by
  surface: batch capacity for the owner, marking progress for the coach and
  membership runway for the parent (see `components/ui/RunwayStrip.tsx`).
- **Props:** `time`, `title`, `subtitle`, `started`, `ended`, `detail`, an
  optional `trailing` element, an optional `icon` and a `tone` of `water`,
  `warn` or `late`.
- **Rules:** the fill colour is `water` normally, `warn` when under-filled
  and `late` when there is a problem. The strip never carries a percentage
  where the underlying meaning is a count of marks.
- **Mobile:** the strip is 6px tall and full width; the label row above it
  carries the two numbers.

### `components/ui/RunwayStrip.tsx`

- **Purpose:** the membership runway — a plan's used and remaining days.
- **Props:** `label`, `startLabel`, `endLabel`, `usedDays`, `totalDays`, an
  `expired` flag.
- **Rules:** the fill turns `warn` past 80% and `late` when expired. The
  strip is decorative; the numbers are always written in text beside it.

### `components/ui/ProgressBar.tsx`

- **Purpose:** a bounded 0..max value.
- **Props:** `value`, `max`, `tone` (`water`, `warn`, `late`, `good`) and an
  accessible `label`.
- **Rules:** used where a strip would be wrong — never as a substitute for a
  count the reader needs.

### `components/ui/StatusBadge.tsx`

- **Purpose:** the status pill, and the lifecycle-to-tone maps that go with
  it.
- **Props:** `tone` (`good`, `warn`, `late`, `neutral`, `water`) plus
  children. The exported maps are `MEMBER_STATUS_TONE`, `ENQUIRY_STAGE_TONE`,
  `TENANT_STATUS_TONE`, `SESSION_STATUS_TONE` and `ATTENDANCE_MARK_TONE`.
- **Rules:** a badge always carries a word, never colour alone. A new
  lifecycle uses one of the existing maps or adds a map entry — never a
  one-off pill. The accent colour is never a status tone.
- **Mobile:** the label is 11px and never truncates to nothing.

### `components/ui/CountChip.tsx`

- **Purpose:** a small count with a label, used beside a heading.
- **Props:** `count`, optional `label`, optional `tone`.
- **Rules:** it states the true total, including items not currently on
  screen.

### `components/ui/SectionHeader.tsx`

- **Purpose:** a section title with an optional subtitle and an optional
  trailing control.
- **Rules:** the heading baseline is shared across surfaces so Members, Fees,
  Programs and Settings line up. It is a heading, not a decorative eyebrow.

### `components/ui/SegmentedTabs.tsx`

- **Purpose:** a small set of mutually exclusive sections.
- **Props:** `tabs` (key, label, href), the `active` key and an
  `ariaLabel`.
- **Rules:** it is a link-based tablist: the active state is a URL, so a
  shared link opens the same view and Back behaves. The selected content is
  rendered once its data is ready. It scrolls sideways on a narrow screen
  inside its own region — the page never scrolls sideways.

### `components/ui/DataTable.tsx`

- **Purpose:** the desktop working table.
- **Props:** `columns` (key, label, optional right alignment, a render
  function), `rows`, `rowKey`, an `empty` node and an optional `onRowClick`.
- **Rules:** at `lg+` the columns align, money is right-aligned and the row
  height is stable; below `lg` a two-line row is used instead of compressed
  columns. The table may scroll sideways inside its own labelled region.

### `components/ui/Row.tsx`

- **Purpose:** a label-and-value line inside a detail card.
- **Props:** `label`, `value`, an optional `action`.
- **Rules:** the label is muted 12px, the value is 14px and wraps. Long
  values break rather than truncate; a value that is a money amount uses
  tabular figures.

### `components/ui/EmptyState.tsx`

- **Purpose:** the designed empty state — name the state, say what is true,
  offer the verb that changes it.
- **Props:** `title`, optional `body`, an optional `action` and an optional
  quieter `secondaryAction`.
- **Rules:** every list has one. An empty block with no words is a bug. The
  secondary action never competes with the primary verb.

### `components/ui/FieldError.tsx`

- **Purpose:** the inline validation message under a field.
- **Props:** an optional `id` used by the field's `aria-describedby`, and
  children.
- **Rules:** the message says what to do next, not what failed. It renders
  nothing when there is no error, so it can sit in the markup permanently.

### `components/ui/BackLink.tsx`

- **Purpose:** the way back from a detail screen.
- **Props:** `href` and `label`.
- **Rules:** it is a real link with a 44px minimum target — the coach's
  register screen has to be reachable one-handed mid-session.

### `components/ui/DateField.tsx`

- **Purpose:** the date input, with the display/ISO conversion helpers
  `isoToDisplay` and `displayToIso`.
- **Rules:** a native date field is used where the platform supports it, and
  the displayed format is checked in both the Indian and the United States
  locale — setting the language alone does not control what the browser
  renders. The input is 16px.

### `components/ui/StickyActionBar.tsx`

- **Purpose:** the sticky action row for a long form or a long list.
- **Rules:** it sits above the bottom navigation and clears the safe area.
  It reserves its own space so it never covers the last field, the consent
  block or a focused control. It is not a save button on an auto-saving
  surface.

### `components/ui/Tap.tsx`

- **Purpose:** the touch-target helper. It clones its child and adds a
  minimum height and width.
- **Rules:** use it when a real control is too small, never to fake an
  interactive element.

## Foundation primitives delivered by the UI-foundation lane

These are the **UI foundation lane's** primitives, read from that lane's
tree. They are additive: the eighteen primitives above are unchanged
(byte-identical to the foundation's copies), and these sixteen are new.

**They are not in this worktree yet.** They arrive when the foundation lane
is integrated. Until then the component inventory test accepts them through
the machine-readable block below, which is exactly what that block is for.
Do not build a local copy of any of them, and do not rename one to match a
name invented here.

<!-- screen-contract:foundation-components
components/ui/Badge.tsx | UI foundation | a neutral or soft tag; StatusBadge owns status meaning
components/ui/Card.tsx | UI foundation | the surface primitive with header, title, description, content and footer slots
components/ui/Checkbox.tsx | UI foundation | a controlled checkbox for consent and multi-option choices
components/ui/Dialog.tsx | UI foundation | a native dialog: focus trap, inert background, Escape and focus restore for free
components/ui/Field.tsx | UI foundation | label, description, control and error composed with the ARIA wiring done once
components/ui/InlineFeedback.tsx | UI foundation | the in-page neutral, success or error line next to a field or a section
components/ui/Input.tsx | UI foundation | the 16px text input with an invalid state and a forwarded ref
components/ui/Label.tsx | UI foundation | the label with the required marker
components/ui/Menu.tsx | UI foundation | a dropdown of row actions with a trigger, an icon slot and disabled items
components/ui/Pagination.tsx | UI foundation | paged list navigation with a stated total
components/ui/Select.tsx | UI foundation | the styled native select
components/ui/Switch.tsx | UI foundation | a boolean setting with a visible label
components/ui/Tabs.tsx | UI foundation | a controlled in-page tablist
components/ui/Textarea.tsx | UI foundation | the multi-line input with an invalid state and a forwarded ref
components/ui/Toast.tsx | UI foundation | ToastProvider and useToast: the transient confirmation of a completed action
components/ui/cn.ts | UI foundation | the class merge helper: a caller's className overrides a primitive's own classes
-->

### `components/ui/Input.tsx` and `components/ui/Textarea.tsx`

- **Purpose:** the text controls. Both take an `invalid` prop for the
  invalid state, and both forward their ref, so a page can focus the
  control it needs to.
- **Rules:** the text is 16px, or iOS zooms on focus. `invalid` is the only
  way to mark the control as invalid — never a hand-written colour. The
  `size` attribute is excluded from the input's props so a caller cannot
  shrink the control below the touch-target floor by accident.

### `components/ui/Label.tsx`

- **Purpose:** the label, with a `required` marker.
- **Rules:** a real `<label htmlFor>`. A control without a programmatic
  label is a defect; the required marker is text, not an asterisk glyph
  alone.

### `components/ui/Field.tsx`

- **Purpose:** one field composed — label, optional description, the
  control, and the error — with the ARIA wiring done once.
- **Props:** `id`, `label`, optional `description`, optional `error`,
  optional `required`, and a **render function** that receives the control
  props (`id`, `aria-describedby`, `aria-invalid`, `aria-required`).
- **Rules:** the render function is how the control gets its `id` and its
  `aria-describedby`; a page that ignores those props has produced an
  unlabelled or undescribed control. The description and the error are
  referenced by the control, so a screen reader hears the error with the
  field. `FieldError` renders the error text.

### `components/ui/Select.tsx`

- **Purpose:** the styled native `<select>`.
- **Rules:** a native control is used wherever it can do the job — the
  platform's keyboard and mobile behaviour is correct for free. A
  combobox is a separate decision, and it is not this component.

### `components/ui/Checkbox.tsx`

- **Purpose:** a controlled checkbox — `checked`, `onCheckedChange`, and
  an optional child label.
- **Rules:** consent choices use it. It is controlled: the caller owns the
  state, so a failed save can keep the checked value.

### `components/ui/Switch.tsx`

- **Purpose:** a boolean setting with a visible `label`.
- **Rules:** a switch states a state that is on or off right now (a
  preference); a checkbox states that something is included (a consent).
  Do not swap them.

### `components/ui/Tabs.tsx`

- **Purpose:** a controlled in-page tablist — `label` (the tablist's
  accessible name), `value`, `onValueChange`, and `tabs` of `{ value,
  label, disabled }`.
- **Rules:** it is **controlled and client-side**: the section it shows is
  the caller's state. For sections that are a URL — the dues/invoices/
  transactions tabs on `/owner/fees` — use `components/ui/SegmentedTabs.tsx`
  instead, so a shared link opens the same view and Back behaves.

### `components/ui/Dialog.tsx`

- **Purpose:** the confirmation dialog. `open`, `onOpenChange`, `title`,
  optional `description`, optional `children`, optional `footer`,
  optional `hideClose`.
- **Rules:** it is built on the native `<dialog>`, so the focus trap, the
  inert background, Escape and the top layer come from the platform — no
  dependency and no half-implemented focus management. Focus returns to
  whatever opened it. A destructive action is confirmed here. A **sheet**
  is a different thing: a short contextual task, and a long form is a
  page. There is no sheet primitive yet, so a page task that needs one
  asks the foundation lane rather than building a local one.

### `components/ui/Menu.tsx`

- **Purpose:** the row-action dropdown — a `trigger`, a list of
  `{ label, icon?, onSelect?, disabled? }`, and an `align`.
- **Rules:** a row action menu holds the actions of one row and nothing
  else. The dominant action of a screen stays on the screen; it does not
  hide in a menu.

### `components/ui/Toast.tsx`

- **Purpose:** the transient confirmation of a completed action —
  `ToastProvider` plus `useToast()`, with a `title` and an optional
  `description`.
- **Rules:** a toast confirms something that already happened. It never
  carries an error the person must act on, and it never replaces inline
  feedback: a field's validation message stays next to the field. It is
  announced to assistive technology.

### `components/ui/InlineFeedback.tsx`

- **Purpose:** the in-page line — `tone` of `neutral`, `success` or
  `error` — beside a field or under a section.
- **Rules:** this is where a save result or a recoverable error goes when
  the person must read it. `error` says what to do next, not what failed.

### `components/ui/Card.tsx`

- **Purpose:** the surface primitive, with `CardHeader`, `CardTitle`,
  `CardDescription`, `CardContent` and `CardFooter`.
- **Rules:** it replaces page-local card chrome, so the radius, the
  border and the padding are the same everywhere. Cards nest only when the
  inner card is genuinely a different surface; a card inside a card for
  decoration is a defect.

### `components/ui/Badge.tsx`

- **Purpose:** a neutral or soft tag, `variant` of `neutral` or `soft`.
- **Rules:** a Badge is a **label**, not a state. Status meaning belongs
  to `components/ui/StatusBadge.tsx` and its lifecycle maps. A Badge never
  carries the accent colour as a status, and it always carries a word.

### `components/ui/Pagination.tsx`

- **Purpose:** paged list navigation — `page`, `pageCount`,
  `onPageChange` and an optional `label`.
- **Rules:** it states the total and the current page, and the control
  height is stable across pages. The filtered set's count is the one it
  paginates.

### `components/ui/cn.ts`

- **Purpose:** the class merge helper — `clsx` for conditional class
  lists, `tailwind-merge` so a caller's `className` **overrides** a
  primitive's own conflicting utilities instead of losing the specificity
  battle.
- **Cost:** the pair is roughly 7 KB gzipped, and only on the routes that
  import a foundation primitive (the foundation lane's recorded figure).
- **Rules:** a page task overrides a primitive's spacing or radius
  through `className`, not by editing the primitive.

### Still outstanding from the foundation lane

Two primitives this contract asked for have not been delivered yet, and
they are **not** in the block above because they do not exist anywhere:

- A **skeleton** primitive — the layout-preserving placeholder a loading
  state uses instead of a spinner. Until it exists, a loading state keeps
  the current placeholder markup and does not pretend to be a primitive.
- A **sheet** primitive — a short contextual task. Until it exists, a
  short task is a page.

### Notes for the consumers

- The Appearance control is a **personal** preference. It must not be a
  tenant setting, must not require a database table, and must not leak a
  previous account's choice on a shared device. The parent token page must
  never receive it. The foundation lane owns it; it has not been delivered
  yet, so no page task may assume it exists.
- A page task that needs one of the primitives above waits for the
  foundation lane's integration. It does not build a local copy, and it
  does not rename a primitive to a name invented here.

## Shell and chrome

| Component | Purpose | Notes |
| --- | --- | --- |
| `components/owner-shell.tsx` | The owner frame: desktop sidebar, sticky top bar with record search, facility switcher, content capped at 1280px, mobile bottom navigation | Foundation-owned. Coach and reception never import it. |
| `components/owner-side-nav.tsx` | The grouped desktop sidebar | Shares the active-state resolution with the bottom navigation so the two can never disagree. |
| `components/bottom-nav.tsx` | The four-item mobile navigation | Exactly four items. The search stays in the header; it is never a fifth item. |
| `components/global-search.tsx` | The record search in the shell | Coarse-gated on the member read; per-kind checks happen in the service. |
| `components/facility-switcher.tsx` | The location scope control | Renders itself away for a single-location tenant. |
| `components/tenant-sign-out.tsx` | Ending the session | Available from every surface; the owner shell adds one when the role has no Settings destination. |
| `components/parent-link-explainer.tsx` | The staff-side explanation of the parent's signed link | Shown at `/parent`; it is not a parent surface. |

## Owner domain components

| Component | Screen | Purpose |
| --- | --- | --- |
| `components/owner-dashboard.tsx` | `/owner` | The Home composition: summary tiles, Today, attention queue, chart band. |
| `components/owner-home-charts.tsx` | `/owner` | The wide metric panel and the payment-mix chart, with the drill-through links that carry the scope. |
| `components/charts/echarts-owner.tsx` | `/owner`, `/owner/reports` | The lazy chart island. Server-rendered data table below `lg` so a phone never downloads the engine. |
| `components/charts/owner-chart-island.tsx` | chart hosts | The client boundary that mounts the chart on demand. |
| `components/members-board.tsx` | `/owner/members`, `/reception/members` | The divided member list with its filters. |
| `components/fees/fees-tabs.tsx` | `/owner/fees` | The URL-state tab strip for dues, invoices and transactions. |
| `components/fees/fees-invoice-list.tsx` | `/owner/fees` | The invoice and transaction rows. |
| `components/reports/analytics-cards.tsx` | `/owner/reports` | The report card host. |
| `components/reports/report-card-error.tsx` | `/owner/reports` | The per-card failure state that keeps the rest of the page alive. |
| `components/onboarding-checklist.tsx` | `/owner/onboarding`, `/owner/settings` | The setup checklist. |
| `components/owner-schedule-grid.tsx` | `/owner/schedule` | The read-only schedule grid. |
| `components/owner-reset-links.tsx` | `/owner/staff` | Owner credential recovery links. |

## Coach, reception and worker domain components

| Component | Screen | Purpose |
| --- | --- | --- |
| `components/register-board.tsx` | `/coach/register/[sessionId]` | The register: mark, lane strip, and the offline queue states. It owns the offline banner wording. |
| `components/reception-check-ins.tsx` | `/reception` | The sessions the desk can mark. It degrades to read-only when the mark permission is absent. |
| `components/staff-attendance-board.tsx` | `/reception` | Staff check-in and check-out at the desk. |
| `components/collect-payment.tsx` | `/reception/collect-payment` | The payment QR block. |
| `components/payment-record-form.tsx` | `/reception/collect-payment`, `/owner/fees` | Recording a payment: amount, method, invoice. It refuses an offline save. |
| `components/reception-close-day.tsx` | `/reception/close` | Counting the cash and confirming the close. |
| `components/cafe-order-screen.tsx` | `/reception/cafe` | The counter order. |
| `components/my-shifts-card.tsx` | `/coach/me`, `/reception/me`, `/worker` | Own shifts. |
| `components/my-attendance-card.tsx` | `/coach/me`, `/reception/me`, `/worker` | Own check-in and check-out. |
| `components/my-leave-card.tsx` | `/coach/me`, `/reception/me`, `/worker` | Own leave requests and balances. |

## The parent page

The parent surface has **no client components at all**. It is server-rendered
markup with zero JavaScript, and it must stay that way: no theme script, no
service-worker registration, no install prompt, no analytics. The parent
page therefore consumes **none** of the primitives above — it uses the token
values directly as inline styles, exactly as it does today. Adding a shared
client component to that page is a contract violation, not an improvement.

## What a page task may change

- The page it owns, and the page-local components that belong to it.
- The composition of the shared primitives it consumes.
- The order of items, the copy, and the empty and error states.

What a page task may **not** change:

- A shared primitive's props or its rendered semantics.
- A permission, a gate, or a route.
- The money representation, the date representation or the timezone.
- The zero-JavaScript, no-store contract of the parent token page.
- The offline identity, expiry and logout-purge model.

### `components/ui/menu-bounds.ts`

Internal Menu geometry helper. Intersects the visible viewport with a clipping
ancestor, chooses above/below placement, and bounds the menu's height and width.
Pages consume Menu rather than calling this helper to build another dropdown.

### `components/ui/menu-name.ts`

Internal Menu accessible-name helper. Preserves a trigger's own readable label
and supplies the explicit fallback for icon-only triggers. Pages must provide a
meaningful label; geometry and naming helpers do not add another visual system.
