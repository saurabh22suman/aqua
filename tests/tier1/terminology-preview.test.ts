import { describe, expect, it } from "vitest";
import { SAMPLE_SENTENCES } from "@/components/terminology/terminology-form";

// fix/vocabulary-plural — preview sentence template used to
// hard-code an `s` after `${n}` for English. The closed-key
// resolver at lib/terminology/keys.ts is correct — `resolveTerm`
// returns the operator's plural verbatim — but the preview line
// in the terminology editor appended a stray `s` on top, so a
// swim club that renamed "member → swimmer" saw the editor
// preview render "12 swimmerss marked present". The runtime
// uses resolveTerm, so production copy is fine; the bug is
// editor-only, but it's the editor the operator uses to verify
// the rename before saving.
//
// This test pins the preview template's shape per locale and per
// plural form. It deliberately covers:
//
//   - Defaults that happen to end in `s` (`members`, `batches`,
//     `coaches`, `sessions`, `programs`, `facilities`, `guardians`,
//     `enquiries`) — these are the `DEFAULT_TERMS.en.*.other`
//     values that ship today. With the bug, every one renders
//     with a trailing double-s (`memberss`, `batchess`, ...).
//   - Overrides that already end in `s` (`boxes`, `swimmers`,
//     `programmes` UK) — pin the no-double-s rule on the
//     pre-suffixed case so a future "let's just always strip
//     the s" fix can't silently regress.
//   - Hindi (`hi`) and Bengali (`bn`) — their templates never
//     appended `s`, so they render correctly today. Pin the
//     absence-of-trailing-s so the next locale added doesn't
//     inherit the same shape by copy-paste.
//
// Pure-data, DB-free: the only thing under test is the
// `SAMPLE_SENTENCES` map. No pool, no withTenant, no auth.

const EN_DEFAULTS: ReadonlyArray<string> = [
  "members",
  "batches",
  "coaches",
  "sessions",
  "programs",
  "facilities",
  "guardians",
  "enquiries",
];

// Overrides the operator could plausibly set — the cases the
// shipped defaults don't already cover. `swimmers` is the swim
// preset's member override. `boxes` and `programmes` exist to
// pin the no-double-s rule on nouns that already end in `s`.
// `kids` and `staff` are irregular-friendly plurals that don't
// end in `s` at all.
const EN_OVERRIDES: ReadonlyArray<string> = [
  "swimmers",
  "boxes",
  "programmes",
  "kids",
  "staff",
];

describe("SAMPLE_SENTENCES — English plural (fix/vocabulary-plural)", () => {
  it.each(EN_DEFAULTS)(
    "renders `12 %s marked present` for the default plural `%s` (no double-s)",
    (n) => {
      const out = SAMPLE_SENTENCES.en.plural(n);
      expect(out).toBe(`12 ${n} marked present`);
    },
  );

  it.each(EN_OVERRIDES)(
    "renders `12 %s marked present` for the override plural `%s` (no double-s)",
    (n) => {
      const out = SAMPLE_SENTENCES.en.plural(n);
      expect(out).toBe(`12 ${n} marked present`);
    },
  );

  it("does NOT append a stray `s` — the template must not hard-code English plural morphology", () => {
    // Catch-all: the literal string template must not contain
    // `${n}s` (the exact pattern that produced "memberss" etc.).
    // If a future copy-paste reintroduces the bug, this fails on
    // any plural, including ones not enumerated above.
    for (const n of [...EN_DEFAULTS, ...EN_OVERRIDES]) {
      const out = SAMPLE_SENTENCES.en.plural(n);
      expect(out).not.toMatch(/s{2,}\b/);
      expect(out).not.toMatch(new RegExp(`${n}s `));
    }
  });
});

describe("SAMPLE_SENTENCES — English singular (regression pin)", () => {
  it.each(["member", "batch", "coach", "session", "swimmer", "kid"])(
    "renders `1 %s marked present` for the singular `%s`",
    (n) => {
      const out = SAMPLE_SENTENCES.en.singular(n);
      expect(out).toBe(`1 ${n} marked present`);
    },
  );
});

describe("SAMPLE_SENTENCES — Hindi and Bengali (no stray `s`)", () => {
  // The broken template only ever appended `s` in the English
  // branch, so these locales are accidentally correct. Pin the
  // shape so the next locale added doesn't inherit the bug by
  // copy-paste from the English branch.

  it.each([
    ["hi", "सदस्य"],
    ["hi", "बैच"],
    ["bn", "সদস্য"],
    ["bn", "ব্যাচ"],
  ] as const)(
    "renders the locale's plural template unchanged for `%s` `%s`",
    (locale, n) => {
      const out = SAMPLE_SENTENCES[locale].plural(n);
      // The templates are `"12 ${n} उपस्थित"` and
      // `"12 ${n} উপস্থিত"` — both interpolate `${n}` verbatim
      // and append the locale's "present" word. Assert the output
      // contains `${n}` unchanged and does not end with an ASCII
      // `s`.
      expect(out).toContain(n);
      expect(out).not.toMatch(/s$/);
    },
  );
});
