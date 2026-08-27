# DESIGN.md

**The visual system for Aqua. Loaded on every UI task. Non-negotiable.**

Reference implementation: `docs/sports-club-ui-direction.html`.

---

## The thesis

**Colour means money and attendance state. Nothing else.**

A coach reads a register at 6:45 AM in direct sunlight with wet hands. Green is present. Red is absent. Amber needs attention. If colour is also used decoratively, that system collapses and the screen has to be read word by word.

Everything below follows from this.

---

## 1. Tokens

### 1.1 Palette

```js
// tailwind.config.ts — theme.extend.colors
{
  deck:    '#EDF0EC',   // page background — pool deck tile
  paper:   '#FFFFFF',   // card surfaces
  ink:     '#0F1F1C',   // primary text
  'ink-2': '#3C534F',   // secondary text
  'ink-3': '#7B918D',   // muted text, icons
  marine:  '#0D3B36',   // hero blocks, dark surfaces
  water:   '#0E7C86',   // DATA only — charts, capacity, progress
  'water-soft': '#E3F1F2',
  line:    'rgba(15,31,28,.10)',

  // SEMANTIC — reserved meanings, never decorative
  good:    '#2E9E5B',   // paid · present
  'good-soft': '#E4F4EA',
  late:    '#D8453C',   // overdue · absent
  'late-soft': '#FCE9E7',
  warn:    '#B8710A',   // needs attention
  'warn-soft': '#FDF0DC',
}
```

### 1.2 Accent — runtime token

The brand accent is `--accent`, set on `<html>` from resolved tenant branding. **Six approved values only. Never a colour picker.**

```
mango (default) · marine · indigo · plum · forest · slate
```

```css
:root {
  --accent:      #FF7A18;   /* mango */
  --accent-soft: #FFEEE1;
  --accent-ink:  #B84E00;   /* accent text on soft background */
}
```

Use for: the single primary action on a screen, active nav state, focus rings.

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
nothing in this product needs them today; Devanagari/Bengali are a
Phase 4 problem, solved separately), `font-display: swap`.

**Combined budget 45 KB — currently 55.2 KB (measured), over budget.**
The three static latin files (`instrument-sans-latin-400`,
`instrument-sans-latin-500`, `bricolage-grotesque-latin-600`, woff2) are
16.5 + 16.8 + 21.9 KB. Switching off the variable axis was the
authorized fix for the 76 KB variable-font measurement; it wasn't enough
on its own to close the gap, and dropping a weight to force it under 45
KB wasn't authorized — this is a known, open gap, not a silently
accepted one.

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
borderRadius: { card: '20px', ctl: '14px', pill: '9999px' }
boxShadow: {
  1: '0 1px 2px rgba(15,31,28,.05)',
  2: '0 2px 6px rgba(15,31,28,.05), 0 14px 32px rgba(15,31,28,.08)',
}
```

**Two shadow levels. Never a third.** Default to a `1px solid line` border instead — shadows read as 2016. Shadow 2 is for floating elements only (nav bar, sticky action bar, modals).

### 1.5 Motion

150ms, on hover and press only. No entrance animations, no scroll effects, no stagger. Respect `prefers-reduced-motion` — disable all transitions under it.

---

## 2. Layout rules

- **Mobile-first, always.** Coaches use this one-handed while standing.
- Touch targets **44 × 44px minimum**.
- Inputs at **16px** font size — anything smaller triggers iOS zoom-on-focus.
- Bottom nav: **exactly four items**. There is no "More" tab. If a fifth thing seems necessary, something else is wrong.
- Role layouts are separate route groups, not conditional rendering. A worker's bundle must not contain owner components.
- **No dark mode.** Users are outdoors in daylight. High-contrast light wins.

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

### Primary action

```jsx
<button className="w-full rounded-pill py-4 text-[14.5px] font-semibold
                   text-white bg-[var(--accent)] transition-colors duration-150">
  Send reminders on WhatsApp
</button>
```

One primary action per screen. Everything else is secondary or a plain link.

### Empty state — built with the list, never after

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

---

## 4. Writing

- **Sentence case everywhere.** Never Title Case.
- Currency: `₹18,200` — grouped Indian-style, no decimals unless paise are meaningful.
- Dates: `22 Aug`, `Sat 22 Aug`. Never `08/22`.
- Every attention item states **why it's there**: "3 trial enquiries — no follow-up in 2 days," not "3 enquiries."
- Errors say what to do next, not what failed.
- Never hard-code vocabulary. Use `term(ctx, 'member', 'other')` — the tenant may call them swimmers, players or students.

---

## 5. Performance

| Metric | Limit |
|---|---|
| First-load JS, gzipped | **150 KB** — build fails above |
| Fonts | 45 KB |
| LCP, 4G mid-tier Android | 2.5s |
| Lighthouse mobile | > 90 |

Rules that keep it there:

- Server Components by default. Client islands only: attendance marker, booking calendar, POS keypad, charts.
- Icons: `import { Check } from 'lucide-react'` — **never** the barrel import. This is the single most common way an AI-generated Next.js app ships 100 KB it doesn't need.
- No chart library on any mobile route. Server-render SVG or lazy-load behind interaction.
- No component library. shadcn/ui copied source only.
- Images through `next/image` with explicit dimensions.

---

## 6. Never

| Never | Why |
|---|---|
| A raw hex value in a component | Tokens are the system |
| `--accent` in a status or state style | Destroys the colour thesis |
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
