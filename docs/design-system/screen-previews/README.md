# Screen previews — wireframes of the screen contracts

Lane: **Screen contracts** (`design/screen-contracts`), 26 October 2026.

`index.html` is a self-contained preview of the screens specified in
[screens.md](../screens.md). Open it directly in a browser — it has no build
step, no dependency and no network access.

## What these previews are

- **Wireframes, not designs.** They show the composition, the order and the
  proportion of each block — which block dominates, what is a row, what is a
  sheet, where the scroll is. They do not show final styling.
- **Structure, not data.** Every block carries a label instead of a value
  ("Collected today", "one attention row"). No figure in a preview is a real
  figure. A preview never invents a count, an amount, a trend or a
  percentage.
- **Honest geometry.** The mobile frames are 390px wide and the desktop
  frames are 1280px wide — the actual contract viewports, not an
  approximation. The frames scroll sideways inside their own box on a narrow
  browser window; the preview does not shrink them to fit.
- **Tokens are copies, not a new palette.** The colours in the preview are
  the values in `app/globals.css` at the time of writing. `app/globals.css`
  is the source of truth; if the tokens change, the preview is stale and
  must be updated by hand.

## What these previews are not

- Not evidence that a screen has been implemented, tested or accepted.
- Not a substitute for the browser acceptance in
  [`docs/ui-quality-contract.md`](../../ui-quality-contract.md): real
  rendering, real scrolling, real keyboard behaviour.
- Not a place for the eight-screen illustration's avatars, gradients,
  placeholder counts or chart label mistakes. The reference boards are
  inspiration; the contracts in `screens.md` are the specification.

## How to keep them honest

1. Change the contract first. `screens.md` is the source of truth; the
   preview follows it.
2. Keep the callout numbers in step with the notes under each preview.
3. When a screen's states change, change the states list in the same edit.
   The preview names the states a screen must handle; a screen that gains a
   state without the preview gaining it is a contract drift.
4. The structural test `tests/design-screen-contracts.test.ts` checks that
   the contracts and the application agree on routes, permissions and
   components. It does not check the preview; the preview is checked by
   reading it against the contract.

## Previews included

| Preview | Route | Viewport |
| --- | --- | --- |
| Owner Home | `/owner` | mobile and desktop |
| Owner Members | `/owner/members` | mobile and desktop |
| Owner Fees | `/owner/fees` | mobile |
| Owner Settings | `/owner/settings` | mobile |
| Coach Today | `/coach` | mobile |
| Coach Register | `/coach/register/[sessionId]` | mobile |
| Reception Today | `/reception` | mobile |
| Reception Collect payment | `/reception/collect-payment` | mobile |
| Parent token page | `/p/[token]` | mobile |
| Ops Overview | `/ops` | desktop |
