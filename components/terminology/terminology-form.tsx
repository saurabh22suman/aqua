"use client";

import { useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import {
  DEFAULT_TERMS,
  titleCase,
  resolveTerm,
  type TermKey,
  type TerminologyState,
} from "@/lib/terminology/keys";
import {
  updateTermOverrideAction,
  clearTermOverrideAction,
} from "@/lib/actions/terminology";

// Phase 2.10 — terminology editor. Eight rows, each with
// singular + plural forms. One primary CTA on the row saves
// just that row — saves are granular so the owner doesn't
// draft across all eight and find one row's input has rotted
// by the time they save. "Use default" restores the locale
// default for that key, which the resolveTerm() fallback
// picks up automatically (deletes the override key).
//
// Composition: the dominant element here is the row itself —
// each row shows the current rendering ("Active members", "1
// member marked present") so the owner sees the change in
// place. The page DOES the same for the whole list at the top,
// rendering a sample sentence pre/post override.

type RowState = {
  one: string;
  other: string;
};

const ROW_KEYS: ReadonlyArray<{
  key: TermKey;
  label: string;
  sampleSentenceSingular: string;
  sampleSentencePlural: string;
}> = [
  { key: "member", label: "Member", sampleSentenceSingular: "1 member marked present", sampleSentencePlural: "12 members marked present" },
  { key: "batch", label: "Batch", sampleSentenceSingular: "1 batch running today", sampleSentencePlural: "4 batches running today" },
  { key: "coach", label: "Coach", sampleSentenceSingular: "1 coach on duty", sampleSentencePlural: "3 coaches on duty" },
  { key: "session", label: "Session", sampleSentenceSingular: "1 session today", sampleSentencePlural: "7 sessions today" },
  { key: "program", label: "Program", sampleSentenceSingular: "1 program running", sampleSentencePlural: "3 programs running" },
  { key: "facility", label: "Facility", sampleSentenceSingular: "1 facility open", sampleSentencePlural: "2 facilities open" },
  { key: "guardian", label: "Guardian", sampleSentenceSingular: "1 guardian on record", sampleSentencePlural: "2 guardians on record" },
  { key: "enquiry", label: "Enquiry", sampleSentenceSingular: "1 enquiry to follow up", sampleSentencePlural: "5 enquiries to follow up" },
];

export function TerminologyForm({ initial }: { initial: TerminologyState }) {
  // Local form state — starts at the resolved values (override
  // wins on the row, otherwise locale default). User edits
  // surface immediately on the "current rendering" line; save
  // commits only this row.
  const [overrides, setOverrides] = useState<Record<TermKey, RowState | undefined>>(() => {
    const out = {} as Record<TermKey, RowState | undefined>;
    for (const row of ROW_KEYS) {
      const en = initial.overrides[row.key]?.en;
      out[row.key] = en ? { one: en.one, other: en.other } : undefined;
    }
    return out;
  });
  const [pendingKey, setPendingKey] = useState<TermKey | null>(null);
  const [errors, setErrors] = useState<Partial<Record<TermKey, string>>>({});
  const [saved, setSaved] = useState<Partial<Record<TermKey, Date>>>({});

  const previewState: TerminologyState = {
    overrides: Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [k, v ? { en: v } : undefined]),
    ) as TerminologyState["overrides"],
    locale: initial.locale,
  };

  function setRow(key: TermKey, partial: Partial<RowState>) {
    const prev = overrides[key] ?? {
      one: DEFAULT_TERMS.en[key].one,
      other: DEFAULT_TERMS.en[key].other,
    };
    setOverrides({ ...overrides, [key]: { ...prev, ...partial } });
    setSaved({ ...saved, [key]: undefined });
  }

  function saveRow(key: TermKey) {
    const row = overrides[key];
    if (!row) return;
    setPendingKey(key);
    setErrors({ ...errors, [key]: undefined });
    updateTermOverrideAction({
      key,
      locale: "en",
      one: row.one.trim(),
      other: row.other.trim(),
    }).then((result) => {
      setPendingKey(null);
      if (result.kind === "error") {
        setErrors({ ...errors, [key]: result.message });
      } else {
        setSaved({ ...saved, [key]: new Date() });
      }
    });
  }

  function resetRow(key: TermKey) {
    setPendingKey(key);
    setErrors({ ...errors, [key]: undefined });
    clearTermOverrideAction({ key, locale: "en" }).then((result) => {
      setPendingKey(null);
      if (result.kind === "error") {
        setErrors({ ...errors, [key]: result.message });
      } else {
        // Reverted to locale defaults — drop the local override
        // so the inputs match the live state.
        setOverrides({ ...overrides, [key]: undefined });
        setSaved({ ...saved, [key]: new Date() });
      }
    });
  }

  return (
    <ul className="space-y-3">
      {ROW_KEYS.map((row) => {
        const oneRaw = overrides[row.key]?.one ?? DEFAULT_TERMS.en[row.key].one;
        const otherRaw = overrides[row.key]?.other ?? DEFAULT_TERMS.en[row.key].other;
        const oneInput = overrides[row.key]?.one ?? "";
        const otherInput = overrides[row.key]?.other ?? "";
        const isCustom = overrides[row.key] !== undefined;
        const isPending = pendingKey === row.key;
        const errorMsg = errors[row.key];
        const savedAt = saved[row.key];

        return (
          <li key={row.key} className="bg-paper border border-line rounded-ctl p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-display text-[14px] font-semibold">{titleCase(row.label)}</h3>
              <span className="text-[11px] uppercase tracking-wide text-ink-3">
                {isCustom ? "Custom" : "Default"}
              </span>
            </div>

            <p className="mt-1.5 text-[12.5px] text-ink-3">
              Reads as: <span className="text-ink-2">{row.sampleSentenceSingular.replace(/1 \w+/, `1 ${oneRaw}`).replace(/member|class/i, oneRaw)}</span>{" "}
              ·{" "}
              <span className="text-ink-2">{row.sampleSentencePlural.replace(/\d+ \w+/, `12 ${otherRaw}`).replace(/members|classes/i, otherRaw)}</span>
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="block text-[12px] text-ink-3 mb-1">Singular</span>
                <input
                  type="text"
                  value={oneInput}
                  onChange={(e) => setRow(row.key, { one: e.target.value })}
                  placeholder={DEFAULT_TERMS.en[row.key].one}
                  maxLength={60}
                  className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px] min-h-[44px]"
                  data-testid={`term-${row.key}-one`}
                />
              </label>
              <label className="block">
                <span className="block text-[12px] text-ink-3 mb-1">Plural</span>
                <input
                  type="text"
                  value={otherInput}
                  onChange={(e) => setRow(row.key, { other: e.target.value })}
                  placeholder={DEFAULT_TERMS.en[row.key].other}
                  maxLength={60}
                  className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px] min-h-[44px]"
                  data-testid={`term-${row.key}-other`}
                />
              </label>
            </div>

            {errorMsg ? (
              <p className="mt-2 text-[12.5px] text-late" role="alert">{errorMsg}</p>
            ) : null}
            {savedAt && !errorMsg ? (
              <p className="mt-2 text-[12.5px] text-good" role="status">Saved.</p>
            ) : null}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => saveRow(row.key)}
                disabled={isPending}
                className="flex-1 rounded-pill py-2.5 text-[13.5px] font-semibold text-paper bg-[var(--accent)] disabled:opacity-70 flex items-center justify-center gap-1.5"
                data-testid={`term-${row.key}-save`}
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
              {isCustom ? (
                <button
                  type="button"
                  onClick={() => resetRow(row.key)}
                  disabled={isPending}
                  className="rounded-pill py-2.5 px-3 text-[13px] font-medium text-ink-2 bg-deck disabled:opacity-50 flex items-center gap-1.5"
                  data-testid={`term-${row.key}-reset`}
                >
                  <RotateCcw size={13} /> Use default
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
      <ResolvePreviewNotice state={previewState} />
    </ul>
  );
}

function ResolvePreviewNotice({ state }: { state: TerminologyState }) {
  // Render a one-line confirmation that resolveTerm actually
  // sees what the form is rendering — the same closed-key
  // helper the rest of the app will use. The text here is
  // medically-precise readout rather than decoration.
  return (
    <li className="text-[12px] text-ink-3 px-1">
      Today&apos;s view uses{" "}
      <span className="text-ink">{titleCase(resolveTerm(state, "member", "other"))}</span>{" "}
      ·{" "}
      <span className="text-ink">{titleCase(resolveTerm(state, "batch", "other"))}</span>{" "}
      ·{" "}
      <span className="text-ink">{titleCase(resolveTerm(state, "session", "other"))}</span>.
      {" "}Database columns stay <span className="text-ink">member_code</span>, never renamed.
    </li>
  );
}
