// Phase 2.10 — terminology: closed term set + locale defaults
// + pure resolver.
//
// Architecture § 7.5 codifies the rules:
//
//   1. TERM_KEYS is closed. Adding a new overridable term is a
//      code change, reviewed. This is what makes the feature
//      typed and testable.
//   2. Overrides layer over locale defaults, per locale. A
//      tenant that overrides "member" in English does not
//      thereby have a Hindi override — it falls back cleanly.
//   3. Terms never appear in DB values, enum values,
//      permission strings, API field names or CSV export
//      headers. Vocabulary is a presentation concern only.
//      `member_code` stays `member_code` whatever the club
//      calls its people.
//   4. Stored shape (one/other per locale) pre-bakes
//      pluralisation. The naive "string replace" approach
//      fails on:
//        - irregular plurals (we don't ship any yet, but the
//          shape makes the failure mode cheap to add)
//        - substring collisions ("member" hits "membership",
//          "remember")
//        - capitalisation (string-replacing over rendered text
//          can't tell mid-sentence from start-of-sentence)
//        - per-locale defaults once Hindi / Bengali land
//
// resolveTerm is exported alongside the data so the lib has no
// server dependencies — both client (the editor preview) and
// server (component rendering) consume it safely.

export const TERM_KEYS = [
  "member",
  "batch",
  "coach",
  "session",
  "program",
  "facility",
  "guardian",
  "enquiry",
] as const;

export type TermKey = (typeof TERM_KEYS)[number];

// Phase 4 language rollout. The schema (tenants.terminology
// jsonb) and the closed-key shape accept arbitrary locales —
// adding a locale is data, not schema. Hindi and Bengali land
// here; the per-locale override picker and the locale-default
// at tenant creation land separately (R.20 follow-up).
export const LOCALES = ["en", "hi", "bn"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export type TermForms = { one: string; other: string };
export type LocaleOverrides = Partial<Record<Locale, TermForms>>;
export type TerminologyOverrides = Partial<Record<TermKey, LocaleOverrides>>;

// English defaults. Pluralisation rules vary; storing both
// forms is the only shape the closed-key resolver above can
// trust without per-key special casing. Add Hindi/Bengali in
// R.20 once the type-faithful approach has been exercised in
// production for the en case.
export const DEFAULT_TERMS: Record<Locale, Record<TermKey, TermForms>> = {
  en: {
    member: { one: "member", other: "members" },
    batch: { one: "batch", other: "batches" },
    coach: { one: "coach", other: "coaches" },
    session: { one: "session", other: "sessions" },
    program: { one: "program", other: "programs" },
    facility: { one: "facility", other: "facilities" },
    guardian: { one: "guardian", other: "guardians" },
    enquiry: { one: "enquiry", other: "enquiries" },
  },
  hi: {
    member: { one: "सदस्य", other: "सदस्य" },
    batch: { one: "बैच", other: "बैच" },
    coach: { one: "कोच", other: "कोच" },
    session: { one: "सत्र", other: "सत्र" },
    program: { one: "कार्यक्रम", other: "कार्यक्रम" },
    facility: { one: "सुविधा", other: "सुविधाएँ" },
    guardian: { one: "अभिभावक", other: "अभिभावक" },
    enquiry: { one: "पूछताछ", other: "पूछताछें" },
  },
  bn: {
    member: { one: "সদস্য", other: "সদস্য" },
    batch: { one: "ব্যাচ", other: "ব্যাচ" },
    coach: { one: "কোচ", other: "কোচ" },
    session: { one: "সেশন", other: "সেশন" },
    program: { one: "প্রোগ্রাম", other: "প্রোগ্রাম" },
    facility: { one: "সুবিধা", other: "সুবিধা" },
    guardian: { one: "অভিভাবক", other: "অভিভাবক" },
    enquiry: { one: "অনুসন্ধান", other: "অনুসন্ধান" },
  },
};

// Title-case the term for use at the start of a heading or
// sentence. Per architecture § 7.5, casing is a presentation
// concern handled here, never a stored variant.
export function titleCase(input: string): string {
  if (input.length === 0) return input;
  return input[0]!.toUpperCase() + input.slice(1);
}

export type TerminologyState = {
  overrides: TerminologyOverrides;
  locale: Locale;
};

// count === 1 picks "one"; anything else picks "other".
// Exposed both as the explicit-pair form and via a discriminator
// for ergonomic call sites.
export function resolveTerm(
  state: TerminologyState,
  key: TermKey,
  count: 1 | "other",
): string {
  const overridden = state.overrides[key]?.[state.locale];
  if (overridden && typeof overridden[count === 1 ? "one" : "other"] === "string") {
    return overridden[count === 1 ? "one" : "other"];
  }
  return DEFAULT_TERMS[state.locale][key][count === 1 ? "one" : "other"];
}
