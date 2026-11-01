# KhelSuite Quiet 24 — the reviewed source glyphs

These are the **reviewed source SVGs** of the icon family the product
renders in `components/icons/khel-icons.tsx`. They are kept in the
repository so that the geometry check
(`tests/app-wide-ux-20261031/icon-geometry-equivalence.test.tsx`) can run
on a fresh checkout, in CI and on any machine — it does not depend on a
private or ignored review directory.

They are **not runtime assets**. Nothing in the application loads these
files: the product renders typed static React components, so there is no
asset pipeline, no request and no bundler cost. These files exist to
prove, byte for byte, that the integrated glyphs are still the reviewed
glyphs.

## What is here

- `svg/*.svg` — the **sixteen** reviewed glyphs on one 24×24 grid:
  `announcements`, `attendance`, `audit-activity`, `bookings`, `cafe`,
  `collect-payment`, `enquiries`, `facilities`, `fees`, `members`,
  `programs`, `reports`, `schedule`, `settings`, `staff`, `tenants`.
- Nothing else. No usage-study HTML, no contact sheets, no PNGs, no
  fonts, no archive.

**4963 bytes** in total — the size of the reviewed revision-1 glyph set.

## Provenance

- **Original task:** the app-wide UI correction task of 30–31 October
  2026 (`app-wide-ux-20261031`).
- **Revision:** **revision 1** — a bounded refinement of the original
  family in which the `programs` glyph was replaced (connected rising
  steps plus an ascending arrow) and the other fifteen glyphs were
  unchanged.
- **Supplied revision-1 archive SHA-256:**
  `14f27701ebceedfe74caed335f9c8bfa45c26e55ed6193418ef5d95d2da75992`
  (as recorded for the task; the archive itself is not kept here).
- **Repository copy fingerprint** — SHA-256 over the sixteen files in
  file-name order:
  `38321078fd4aaa4955323973c63c3e811509a00f059bc63a3db0c5a25b0a2de4`
  (4963 bytes). Recompute it with:
  `cd docs/design-system/icons/quiet24/svg && cat $(ls *.svg | sort) | sha256sum`
- **Authorship:** the glyph geometry was authored for this task by an
  OpenAI assistant from a written description; no stock vector, no
  tracing, no external artwork, no font and no icon library was used.
- **Licensing:** no external asset licensing obligation was identified in
  the reviewed material. That is not a legal uniqueness guarantee, and
  it is not a licence claim about any third-party work.
- **Safe-element review:** the reviewed set was XML-parsed and
  allowlisted — no scripts, event handlers, ids, references, bitmaps,
  labels or fonts. The files here are those files, unchanged.

## How the product uses them

`components/icons/khel-icons.tsx` transcribes this geometry into typed
static React. The **only** intended difference is the secondary tone
slot, which shipped in the study as a hex fallback and is integrated as
a theme token (`--icon-secondary`, falling back to `--color-ink-3`). The
geometry itself is unchanged, and the equivalence test asserts it element
for element.
