"use client";

import { useState, useTransition } from "react";
import { updateTenantProfileAction } from "@/lib/actions/tenant-profile";

// PR2-C1 — academy profile editor. One primary action: Save. The
// GSTIN field is the reason this screen exists: a typo used to need a
// platform operator. Validation lives on the server; the field error is
// shown verbatim.

type ProfileState = {
  name: string;
  currency: string;
  timezone: string;
  gstin: string;
};

const inputClass =
  "mt-1 min-h-11 w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink placeholder:text-ink-3 focus:border-[var(--accent-strong)] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";

export function AcademyProfileForm({ initial }: { initial: ProfileState }) {
  const [state, setState] = useState<ProfileState>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function field(key: keyof ProfileState) {
    return {
      value: state[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setState((current) => ({ ...current, [key]: event.target.value }));
        setSavedAt(null);
      },
    };
  }

  function submit() {
    setError(null);
    setSavedAt(null);
    startTransition(async () => {
      const result = await updateTenantProfileAction({
        name: state.name.trim(),
        currency: state.currency.trim().toUpperCase(),
        timezone: state.timezone.trim(),
        gstin: state.gstin.trim(),
      });
      if (result.kind === "error") setError(result.message);
      else setSavedAt(new Date());
    });
  }

  return (
    <div className="space-y-4">
      <label className="block" htmlFor="academy-name">
        <span className="block text-[13px] font-medium text-ink-2">
          Academy name
        </span>
        <input id="academy-name" type="text" {...field("name")} className={inputClass} />
      </label>

      <label className="block" htmlFor="academy-currency">
        <span className="block text-[13px] font-medium text-ink-2">Currency</span>
        <input
          id="academy-currency"
          type="text"
          maxLength={3}
          {...field("currency")}
          className={inputClass}
        />
        <span className="mt-1 block text-[12px] text-ink-3">
          ISO 4217, three uppercase letters.
        </span>
      </label>

      <label className="block" htmlFor="academy-timezone">
        <span className="block text-[13px] font-medium text-ink-2">Time zone</span>
        <input id="academy-timezone" type="text" {...field("timezone")} className={inputClass} />
        <span className="mt-1 block text-[12px] text-ink-3">
          IANA identifier, e.g. Asia/Kolkata.
        </span>
      </label>

      <label className="block" htmlFor="academy-gstin">
        <span className="block text-[13px] font-medium text-ink-2">
          GSTIN (optional)
        </span>
        <input
          id="academy-gstin"
          type="text"
          maxLength={15}
          {...field("gstin")}
          className={inputClass}
        />
        <span className="mt-1 block text-[12px] text-ink-3">
          Changing this affects future invoices only — already-issued documents
          keep the GSTIN they were issued with.
        </span>
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-pill px-5 py-2.5 text-[13px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {savedAt ? (
          <p role="status" className="text-[12.5px] text-ink-2">
            Saved.
          </p>
        ) : null}
      </div>
    </div>
  );
}
