"use client";

import { Input } from "@/components/ui/Input";
import { useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import {
  DEFAULT_TERMS,
  titleCase,
  type Locale,
  type TermKey,
  type TerminologyState,
} from "@/lib/terminology/keys";
import {
  LOCALE_NAMES,
  ResolvePreviewNotice,
  contextualSample,
} from "@/components/terminology/terminology-shared";
import {
  updateTermOverrideAction,
  clearTermOverrideAction,
} from "@/lib/actions/terminology";
import { Button } from "@/components/ui/Button";

// Phase 2.10 + 4.20 — terminology editor. Eight rows, each
// with singular + plural forms, scoped to a single locale at a
// time (the page at /owner/settings/terminology picks the
// locale; the URL is the source of truth so the form has no
// internal locale toggle). One primary CTA on the row saves
// just that row — saves are granular so the owner doesn't
// draft across all eight and find one row's input has rotted
// by the time they save. "Use default" restores the locale
// default for that key, which the resolveTerm() fallback
// picks up automatically (deletes the override key).
//
// P1 (2026-10-13 owner-UI review) — only WRITABLE_LOCALES accept
// writes; a non-writable locale renders read-only (no Save, no
// reset) with a clear explanation, and the page keys this form
// by locale so switching locales never carries the previous
// locale's editor state. Sample sentences are per-term, so the
// preview never claims a guardian was "marked present".

type RowState = {
  one: string;
  other: string;
};

const ROW_KEYS: ReadonlyArray<{
  key: TermKey;
  label: string;
}> = [
  { key: "member", label: "Member" },
  { key: "batch", label: "Batch" },
  { key: "coach", label: "Coach" },
  { key: "session", label: "Session" },
  { key: "program", label: "Program" },
  { key: "facility", label: "Facility" },
  { key: "guardian", label: "Guardian" },
  { key: "enquiry", label: "Enquiry" },
];

// Per-locale sample sentence so the preview rendering shows
// the same language the user is editing. Defaults to English
// placeholders — translations land in the data-only R.20 pass.
// (Kept generic and byte-stable: tests/tier1/terminology-preview
// pins the English template text.)
export const SAMPLE_SENTENCES: Record<Locale, { singular: (n: string) => string; plural: (n: string) => string }> = {
  en: {
    singular: (n: string) => `1 ${n} marked present`,
    plural: (n: string) => `12 ${n} marked present`,
  },
  hi: {
    singular: (n: string) => `1 ${n} उपस्थित`,
    plural: (n: string) => `12 ${n} उपस्थित`,
  },
  bn: {
    singular: (n: string) => `1 ${n} উপস্থিত`,
    plural: (n: string) => `12 ${n} উপস্থিত`,
  },
};


export function TerminologyForm({
  initial,
  locale,
  editable = true,
}: {
  initial: TerminologyState;
  locale: Locale;
  // Server write support for this locale. Read-only locales render
  // resolved values with no Save/reset controls.
  editable?: boolean;
}) {
  // Local form state — starts at the resolved values for *this*
  // locale (override wins on the row, otherwise locale default).
  const [overrides, setOverrides] = useState<Record<TermKey, RowState | undefined>>(() => {
    const out = {} as Record<TermKey, RowState | undefined>;
    for (const row of ROW_KEYS) {
      const loc = initial.overrides[row.key]?.[locale];
      out[row.key] = loc ? { one: loc.one, other: loc.other } : undefined;
    }
    return out;
  });
  // 2026-09-13 UI/UX audit §11 #9 — eight always-primary Save buttons
  // diluted "one primary action" and invited no-op saves. `baselines`
  // tracks the live value per row (override or locale default) so Save
  // stays disabled until a row actually differs from what is stored.
  // Saving or resetting advances the baseline in place, so a row goes
  // quiet again the moment its write lands.
  const [baselines, setBaselines] = useState<Record<TermKey, RowState | undefined>>(() => {
    const out = {} as Record<TermKey, RowState | undefined>;
    for (const row of ROW_KEYS) {
      const loc = initial.overrides[row.key]?.[locale];
      out[row.key] = loc ? { one: loc.one, other: loc.other } : undefined;
    }
    return out;
  });
  const [pendingKey, setPendingKey] = useState<TermKey | null>(null);
  const [errors, setErrors] = useState<Partial<Record<TermKey, string>>>({});
  const [saved, setSaved] = useState<Partial<Record<TermKey, Date>>>({});

  function liveRow(key: TermKey): RowState {
    const baseline = baselines[key];
    if (baseline) return baseline;
    return {
      one: DEFAULT_TERMS[locale][key].one,
      other: DEFAULT_TERMS[locale][key].other,
    };
  }

  function isDirty(key: TermKey): boolean {
    const draft = overrides[key];
    if (!draft) return false;
    const live = liveRow(key);
    return draft.one !== live.one || draft.other !== live.other;
  }

  // Preview state — keyed to the active locale — drives the
  // "Reads as:" sentence at the row top so the user sees the
  // change in place across all terms.
  const previewState: TerminologyState = {
    overrides: Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [k, v ? { [locale]: v } : undefined]),
    ) as TerminologyState["overrides"],
    locale,
  };

  function setRow(key: TermKey, partial: Partial<RowState>) {
    const prev = overrides[key] ?? {
      one: DEFAULT_TERMS[locale][key].one,
      other: DEFAULT_TERMS[locale][key].other,
    };
    setOverrides({ ...overrides, [key]: { ...prev, ...partial } });
    setSaved({ ...saved, [key]: undefined });
  }

  function saveRow(key: TermKey) {
    const row = overrides[key];
    if (!row) return;
    setPendingKey(key);
    setErrors({ ...errors, [key]: undefined });
    void (async () => {
      try {
        const result = await updateTermOverrideAction({
          key,
          locale,
          one: row.one.trim(),
          other: row.other.trim(),
        });
        if (result.kind === "error") {
          setErrors({ ...errors, [key]: result.message });
        } else {
          setSaved({ ...saved, [key]: new Date() });
          setBaselines({
            ...baselines,
            [key]: { one: row.one.trim(), other: row.other.trim() },
          });
        }
      } catch {
        setErrors({
          ...errors,
          [key]: "Could not save this term. Your text is kept — try again.",
        });
      } finally {
        setPendingKey(null);
      }
    })();
  }

  function resetRow(key: TermKey) {
    setPendingKey(key);
    setErrors({ ...errors, [key]: undefined });
    void (async () => {
      try {
        const result = await clearTermOverrideAction({ key, locale });
        if (result.kind === "error") {
          setErrors({ ...errors, [key]: result.message });
        } else {
          // Reverted to locale defaults — drop the local override
          // so the inputs match the live state.
          setOverrides({ ...overrides, [key]: undefined });
          setSaved({ ...saved, [key]: new Date() });
          setBaselines({ ...baselines, [key]: undefined });
        }
      } catch {
        setErrors({
          ...errors,
          [key]: "Could not reset this term. Try again.",
        });
      } finally {
        setPendingKey(null);
      }
    })();
  }

  return (
    <div>
      {!editable ? (
        <p
          role="status"
          className="mb-3 rounded-ctl border border-line bg-deck px-3 py-2 text-[12.5px] text-ink-2"
        >
          {LOCALE_NAMES[locale]} vocabulary is shown read-only. English is the
          only editable locale today; these values come from the shipped
          defaults and any stored overrides.
        </p>
      ) : null}
      <ul className="space-y-3" data-testid={`terminology-form-${locale}`}>
        {ROW_KEYS.map((row) => {
          const defaults = DEFAULT_TERMS[locale][row.key];
          const oneRaw = overrides[row.key]?.one ?? defaults.one;
          const otherRaw = overrides[row.key]?.other ?? defaults.other;
          const oneInput = overrides[row.key]?.one ?? "";
          const otherInput = overrides[row.key]?.other ?? "";
          const isCustom = overrides[row.key] !== undefined;
          const isPending = pendingKey === row.key;
          const errorMsg = errors[row.key];
          const savedAt = saved[row.key];
          const dirty = isDirty(row.key);
          const sample = contextualSample(locale, row.key, SAMPLE_SENTENCES[locale]);

          return (
            <li key={row.key} className="bg-paper border border-line rounded-ctl p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-display text-[14px] font-semibold">{titleCase(row.label)}</h3>
                <span className="text-[11px] uppercase tracking-wide text-ink-3">
                  {isCustom ? "Custom" : "Default"}
                </span>
              </div>

              <p className="mt-1.5 text-[12.5px] text-ink-3">
                Reads as: <span className="text-ink-2">{sample.singular(oneRaw)}</span>{" "}
                ·{" "}
                <span className="text-ink-2">{sample.plural(otherRaw)}</span>
              </p>

              {editable ? (
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="block text-[12px] text-ink-3 mb-1">Singular</span>
                    <Input
                      type="text"
                      value={oneInput}
                      onChange={(e) => setRow(row.key, { one: e.target.value })}
                      placeholder={defaults.one}
                      maxLength={60}
                      className="w-full border"
                      data-testid={`term-${row.key}-one`}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[12px] text-ink-3 mb-1">Plural</span>
                    <Input
                      type="text"
                      value={otherInput}
                      onChange={(e) => setRow(row.key, { other: e.target.value })}
                      placeholder={defaults.other}
                      maxLength={60}
                      className="w-full border"
                      data-testid={`term-${row.key}-other`}
                    />
                  </label>
                </div>
              ) : (
                <dl className="mt-3 grid grid-cols-2 gap-2.5 text-[13px]">
                  <div>
                    <dt className="text-[12px] text-ink-3">Singular</dt>
                    <dd className="text-ink">{defaults.one}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-ink-3">Plural</dt>
                    <dd className="text-ink">{defaults.other}</dd>
                  </div>
                </dl>
              )}

              {errorMsg ? (
                <p className="mt-2 text-[12.5px] text-ink-3" role="alert">{errorMsg}</p>
              ) : null}
              {savedAt && !errorMsg ? (
                <p className="mt-2 text-[12.5px] text-ink-3" role="status">Saved.</p>
              ) : null}

              {editable ? (
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="primary"
                    pill
                    onClick={() => saveRow(row.key)}
                    disabled={isPending || !dirty}
                    className="flex-1"
                    data-testid={`term-${row.key}-save`}
                  >
                    <Save size={14} aria-hidden="true" />
                    {isPending ? "Saving…" : "Save"}
                  </Button>
                  {isCustom ? (
                    <Button
                      variant="secondary"
                      pill
                      onClick={() => resetRow(row.key)}
                      disabled={isPending}
                      data-testid={`term-${row.key}-reset`}
                    >
                      <RotateCcw size={13} aria-hidden="true" /> Use default
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
        <ResolvePreviewNotice state={previewState} locale={locale} />
      </ul>
    </div>
  );
}
