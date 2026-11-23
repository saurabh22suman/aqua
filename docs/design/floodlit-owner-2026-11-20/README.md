# Floodlit Owner Today visual reference

The approved reference is the self-contained HTML in this directory. Its
SHA-256 is `3fe4c92e7ee292eeb7efab08df0bf198152b2773e9bcc6902963343d9607aaa6`.
Use the rendered layout, CSS values and exact assets in the reference when
implementing Owner Today. Keep the reference and the app's implementation
separately runnable. [HTML reference](KhelSuite-Floodlit.html)
· [Desktop 1440×930](Floodlit-Desktop.png) · [Phone 390×844](Floodlit-Mobile.png)
· [Aquatics phone](Floodlit-Aquatics.png)

## Port the approved layout

- Use the reference's edge-to-edge photographic stage within the main content
  column. Date and facility selection sit at its top, followed by the page title.
  The two monetary figures and overdue subset sit inside this same stage.
  Use the supplied WebP and reference scrim, crop and spacing for each width.
- Preserve the warm, separate **Needs attention** strip directly below the
  stage. Keep one priority action and the supporting schedule and collections
  cards below it. Use the reference grid, type scale and breakpoints.
- Use the supplied full Latin **Barlow Condensed Bold** for the title and
  amounts and **DM Sans** for supporting text. Verify the fonts Chromium
  actually uses. The small rupee mark follows the body/fallback stack.
- Keep the app's authorized destinations, scope and navigation behavior,
  including All and any saved default facility. Bind the prototype hierarchy
  to the existing data and actions. Keep the preview's example scenario
  selector and simulated mutations in the standalone HTML.
- Use the one layout for both sports. Swap the verified club artwork and
  existing tenant terminology through configuration.

[Badminton artwork](court.webp) · [Aquatics artwork](pool.webp)
· [Barlow Condensed WOFF2](barlow-condensed-bold-latin.woff2)
· [DM Sans WOFF2](dm-sans-latin.woff2)
· [Barlow license](barlow-ofl.txt) · [DM Sans license](dmsans-ofl.txt)

The approved font pair totals 59,376 bytes. Ship the exact self-hosted files
on Floodlit Owner Home. The 150 KiB gate counts all emitted WOFF2 assets
together, including shared faces.

## Browser review

Give the photographic stage `data-testid="owner-floodlit-hero"` and the
financial labels `data-testid="owner-floodlit-metric-label"`. Reuse the
existing agenda and priority test IDs. Keep the approved stage art in the CSS
background of the stage or its `::before` so the checker can inspect the
asset used by the page. Use a local exact asset for this proof.

Use a private Chromium storage state for a disposable Owner fixture that can
see all facilities. Compare the built route and reference at identical sizes
and use matching sample-shaped records for visual review.

```sh
node scripts/check-owner-floodlit.cjs \
  --url 'https://localhost:3451/owner?facility=all' \
  --storage-state /path/to/private-owner-storage-state.json \
  --output /path/to/evidence
```

Use `--preset pool` for a swimming fixture. The default is `--preset court`.
The script writes both screenshots at 390×844 and 1440×930 and fails on missing
artwork, a displaced finance block, wrong rendered font faces, title size,
significant stage/agenda/priority geometry drift or horizontal overflow.
`--self-check` verifies the reference and checker only. If Chromium is not
installed through Playwright, pass `--executable` with the installed binary.

Review the captures side by side with the same fixture. Inspect the artwork
crop and scrim, color, heading and amount spacing, placement of the first
action and reachable navigation. Check a scoped facility, the second sport
preset, narrow screens, no-finance and unavailable cases separately.
Functional checks still exercise the real permissions and actions. Approval
covers the reviewed running build.
