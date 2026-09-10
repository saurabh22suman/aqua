# Unenforced DESIGN.md rules — inventory and mechanisation plan

A scan for every DESIGN.md rule that's documented but not mechanically
checked. Each row records where it lives, what today catches violations,
and whether a source scan / lint rule / runtime check can replace
review. This is the audit companion to the input-font-size scan that
just landed.

| Rule (DESIGN.md) | Today's enforcement | Mechanisability |
|---|---|---|
| **§1.1 Palette — only token colours** | None. Component hex values would render but break the visual system silently | **Cheap scan**. Tailwind class names like `bg-[#abc123]`, `text-#abc123`, or `bg-#fff` etc. inside `app/` and `components/` fail the build. Whitelist per-file is like the semantic-token list. Same shape as `hardcoded-brand-color.test.ts`. |
| **§1.1 Water is data only** | None directly. `semantic-token-reservation.test.ts` covers good/late/warn but not water | **Cheap scan**. Add `water` to the semantic-token whitelist. Water belongs to capacity bars, lane strips, and the dashboard "today's attendance" hero — same shape as good/late/warn. |
| **§1.2 `--accent` only as a runtime token** | `hardcoded-brand-color.test.ts` catches the inverse (using `bg-mango` etc. instead of `var(--accent)`) | **Partial**. The "no `--accent` inside a status or state style" half isn't checked. A scan that forbids `--accent`, `var(--accent)`, `bg-[var(--accent)]`, etc. inside any class containing `text-good\|text-late\|text-warn\|bg-good\|bg-late\|bg-warn` would do it. Cheap. |
| **§1.3 Font weights 400/500/600 only** | None | **Cheap scan**. Reject `font-bold` (700), `font-extrabold` (800), `font-black` (900). Accept the literal classes; arbitrary value classes would need a `font-[N]` regex too. |
| **§1.3 No font size below 11px** | None. Already found one violation (register-board trial pill at 10px, fixed in 5.6) | **Cheap scan**. Walk JSX text classes, reject `text-[Npx]` with N < 11. Symmetric to the input-font-size scan but with N < 11 instead of < 16. |
| **§1.4 Two shadow levels only** | None. A third shadow would compile and ship | **Cheap scan**. Reject `shadow-3`, `shadow-4`, ... and any `shadow-[Npx_Npx_Npx_Npx_*]` arbitrary shadow that doesn't match the two defined tokens. |
| **§2 Touch targets 44×44px minimum** | None. The 5.6 mobile pass fixed several but memory-only | **Cheap scan, but with semantics**. A `<button>`, `<a>`, or interactive role whose computed `min-h` / `h` is < 44px on a tenant surface fails. The catch: Tailwind classes like `h-11` compile to `height: 2.75rem` (44px) — the regex needs to handle every class expression that contributes to height (`h-N`, `min-h-N`, `py-N+N ≥ 2.75rem`, `size-N`). Doable but the encoding is much larger than the font-size scan. |
| **§2 Bottom nav exactly four items** | Manual. The four BottomNav items per layout are hand-set in `(owner)/(coach)/(reception)` layouts | **Cheap scan**. Reject `items.length !== 4` on a `<BottomNav>` call site by reading `app/**/layout.tsx`. Trivial. |
| **§3 "Designed empty state on every list"** | None. Empty states were audited separately and most exist, but a new list could ship without one | **Hard** to scan statically — "has designed empty state" requires understanding a list pattern (`<ul>` + a hand-coded empty branch). Not worth a scan; reviewer discipline is the right rule here, and 5.4's manual sweep is the closest thing to a gate. |
| **§3 "Skeleton, never spinner"** | None. Spinners in this codebase exist (a few `Loader2 animate-spin` indicators inside submit buttons) | **Cheap scan**. Reject `animate-spin` outside `<button>` and submit-button contexts. The submission-button case is whitelisted per-file; everything else is suspicious. |
| **§4 Sentence case everywhere** | None. The codebase has both; manual review | **Partial** — a Tailwind-aware "TitleCase inside JSX text" detector is doable but produces too many false positives (proper nouns, names) to be useful. Review-time rule. |
| **§5 First-load JS ≤ 150KB, fonts ≤ 45KB (now 60KB)** | `pnpm check:bundle`, `pnpm check:fonts` — already mechanical | **Done**. |
| **§6 "Never" list** | Mixed: hex and shadow see scans; title-case, emoji-as-icons, spinners, gradients don't | See the rows above for the buildable subset. Emoji-as-icon is a useful one — `😀` etc. inside JSX would warn. Gradients (`bg-gradient-*`, `from-*`, `to-*` on a non-card surface) — design disallows them — are also scanable but a bit noisy because gradients are rare here anyway. |
| **Colour as the only carrier of meaning** | None. The "every status pill carries a word" rule is review-time | **Hard** — requires understanding which colour-only states exist and pairing each with text. Not worth a scan. |
| **Spinners** | None (see above) | **Done** in the §3 row. |
| **Emoji as icons** | None. Manual | **Cheap scan**. Reject emoji codepoints inside JSX content. Whitelist a small file list if needed (the demo banner has ✨). |
| **No third shadow level** | None | See §1.4 row. |
| **No dark mode** | None | **Cheap scan**. Reject `dark:` variants in Tailwind classes. |
| **No gradients** | None | **Cheap scan**. Reject `bg-gradient-*` and arbitrary `from-*`/`to-*` linear-gradient classes. |

## Mechanisability scoreboard

- **Already done**: hex-by-scan-redirect (hardcoded-brand), input font-size, semantic-token reservation, vocab source, preset-key reads.
- **Cheap to add** (one source-scan file each, < 100 lines): water-as-data-only, no-700+-weight, no-<11px text, third-shadow ban, bottom-nav-item-count, no-spinners, no-emoji, no-dark-mode, no-gradients.
- **Mechanisable but harder**: 44px touch target (regex encodes Tailwind size semantics).
- **Review-time**: designed empty state, sentence case, status-pill text.

## Order to ship

I'd land the next scans in roughly this order, based on how likely the
class of bug is to recur and how visible it is when it does:

1. No font size <11px (one font-size scan, two rules).
2. No spinners (a single Tailwind class regex; cheap).
3. No `font-bold` etc. (one regex).
4. Bottom-nav-four-items scan (trivially cheap).
5. No dark mode / no gradients / no emoji-as-icon (one combined scan).
6. No third shadow / no raw hex values outside tokens.
7. **44px touch target scan** last — the regex needs to handle every
   class shape that contributes to height, which is the most
   error-prone of the set. Want this on a calm morning.

Each of these is its own PR with a planted-mutation test, the same
shape as `input-font-size.test.ts` and `vocab-source-scan.test.ts`.

---

## Why role-gating is the next ship-stopper and not a scan

Two of the unenforced DESIGN.md rules are bundled with a real
authorization gap (`(owner)/layout.tsx` checks `sessionExists()`, not
role) — see `docs/red-proposals.md` §"Tenant role gating (DPDP)".
The role-gating fix has to land before the next scans go in: a
forbidden-route 404 is a behavior fix, not a UI rule, and conflating
it with a source-scan PR will muddy the audit trail.
