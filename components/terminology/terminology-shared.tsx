"use client";

import { resolveTerm, titleCase, type Locale, type TermKey, type TerminologyState } from "@/lib/terminology/keys";

// Shared terminology-editor helpers, split out of
// components/terminology/terminology-form.tsx to keep that module
// within the line budget. The pinned generic SAMPLE_SENTENCES export
// stays in the form module for its existing test import path.

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
};

// P1 — the sample must read sensibly for each term, not apply the
// attendance sentence to guardians and enquiries. Non-English
// locales keep the locale term unchanged (they are read-only today,
// and the R.20 data pass will land translated sentences).
const CONTEXTUAL_SAMPLES: Record<
  TermKey,
  { singular: (n: string) => string; plural: (n: string) => string }
> = {
  member: { singular: (n) => `1 ${n}`, plural: (n) => `12 ${n}` },
  batch: { singular: (n) => `1 ${n}`, plural: (n) => `3 ${n} running` },
  coach: { singular: (n) => `1 ${n}`, plural: (n) => `2 ${n} on duty` },
  session: { singular: (n) => `1 ${n} today`, plural: (n) => `6 ${n} this week` },
  program: { singular: (n) => `1 ${n}`, plural: (n) => `2 ${n} active` },
  facility: { singular: (n) => `1 ${n}`, plural: (n) => `2 ${n} available` },
  guardian: { singular: (n) => `Primary ${n}`, plural: (n) => `2 ${n} linked` },
  enquiry: {
    singular: (n) => `1 ${n} awaiting follow-up`,
    plural: (n) => `3 ${n} awaiting follow-up`,
  },
};

export function contextualSample(
  locale: Locale,
  key: TermKey,
  fallback: { singular: (n: string) => string; plural: (n: string) => string },
): { singular: (n: string) => string; plural: (n: string) => string } {
  return locale === "en" ? CONTEXTUAL_SAMPLES[key] : fallback;
}

export function ResolvePreviewNotice({
  state,
  locale,
}: {
  state: TerminologyState;
  locale: Locale;
}) {
  // One line confirming what the closed-key resolver sees for the
  // active locale. The locale selector sits on the page; the form
  // itself stays locale-narrow, which is why the preview is too.
  return (
    <li className="text-[12px] text-ink-3 px-1">
      Today&apos;s view uses{" "}
      <span className="text-ink">{titleCase(resolveTerm(state, "member", "other"))}</span>{" "}
      ·{" "}
      <span className="text-ink">{titleCase(resolveTerm(state, "batch", "other"))}</span>{" "}
      ·{" "}
      <span className="text-ink">{titleCase(resolveTerm(state, "session", "other"))}</span>
      . Database columns stay <span className="text-ink">member_code</span>, never renamed.
      <span className="block mt-0.5 text-ink-3">Active locale: <span className="text-ink-2 font-mono">{locale}</span></span>
    </li>
  );
}
