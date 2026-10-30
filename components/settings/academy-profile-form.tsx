"use client";

import Link from "next/link";
import type { ChangeEvent } from "react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { updateTenantProfileAction } from "@/lib/actions/tenant-profile";

// Owner OpenPen management lane (29 October 2026).
//
// Academy profile editor, bounded to 700px. The reference groups the
// academy's identity apart from its billing details; the GSTIN field is
// the reason this screen exists, and its notice states that a change
// affects future invoices only. Validation stays on the server and the
// field error is shown verbatim.

type ProfileState = {
  name: string;
  currency: string;
  timezone: string;
  gstin: string;
};

export function AcademyProfileForm({ initial }: { initial: ProfileState }) {
  const [state, setState] = useState<ProfileState>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function field(key: keyof ProfileState) {
    return {
      value: state[key],
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        setState((current) => ({ ...current, [key]: event.target.value }));
        setSavedAt(null);
      },
    };
  }

  const storedCurrency = state.currency;
  const inrOnly = storedCurrency.toUpperCase() === "INR";
  const indiaTimeZone = ["Asia/Kolkata", "Asia/Calcutta"].includes(
    state.timezone,
  );

  function submit() {
    setError(null);
    setSavedAt(null);
    startTransition(async () => {
      const result = await updateTenantProfileAction({
        name: state.name.trim(),
        // Currency is omitted entirely: the server preserves the actual
        // stored value (including a non-INR one), and an explicit non-INR
        // value would be refused. This keeps every other edit available
        // without silently rewriting or converting the stored currency.
        timezone: state.timezone.trim(),
        gstin: state.gstin.trim(),
      });
      if (result.kind === "error") setError(result.message);
      else setSavedAt(new Date());
    });
  }

  return (
    <form
      className="max-w-[700px] rounded-card border border-line bg-paper p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="font-display text-[16px] font-semibold text-ink">
        Academy identity
      </h2>
      <div className="mt-3">
        <label className="block" htmlFor="academy-name">
          <span className="mb-1 block text-[13px] font-medium text-ink-2">
            Academy name
          </span>
          <Input id="academy-name" type="text" {...field("name")} />
        </label>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Billing details
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 block text-[13px] font-medium text-ink-2">
              Currency
            </p>
            <p className="text-[14px] text-ink">{storedCurrency}</p>
            <p
              id="academy-currency-support"
              className="mt-1 block text-[12px] text-ink-3"
            >
              Aqua records money in INR (₹) only. The stored value is shown as
              recorded and is not editable here.
            </p>
            {!inrOnly ? (
              <p role="status" className="mt-1 text-[12px] text-ink-2">
                This academy&apos;s stored currency “{storedCurrency}” is not
                supported — Aqua records money in INR only. It stays as stored
                and other profile details can still be saved. The stored
                value is preserved; contact the platform to review it.
              </p>
            ) : null}
          </div>

          <div>
            <p className="mb-1 block text-[13px] font-medium text-ink-2">
              Time zone
            </p>
            <p className="text-[14px] text-ink">
              {indiaTimeZone
                ? "India Standard Time (IST)"
                : `Stored value: ${state.timezone}`}
            </p>
            <p className="mt-1 block text-[12px] text-ink-3">
              {indiaTimeZone
                ? "Times across the academy are shown in IST."
                : "This stored time zone is not the India time zone. It is kept exactly as recorded; ask the platform to review it before relying on displayed times."}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label className="block" htmlFor="academy-gstin">
            <span className="mb-1 block text-[13px] font-medium text-ink-2">
              GSTIN (optional)
            </span>
            <Input
              id="academy-gstin"
              type="text"
              maxLength={15}
              {...field("gstin")}
            />
          </label>
        </div>

        <p className="mt-3 border-l-[3px] border-[var(--accent)] bg-deck px-3.5 py-2.5 text-[12.5px] text-ink-2">
          Changing GSTIN affects future invoices only. Already-issued documents
          keep the GSTIN they were issued with.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
        {savedAt ? (
          <p role="status" className="mr-auto text-[12.5px] text-ink-2">
            Saved.
          </p>
        ) : null}
        <Link
          href="/owner/settings"
          className="inline-flex min-h-12 items-center text-[13px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
        >
          Cancel
        </Link>
        <Button
          variant="primary"
          size="md"
          type="submit"
          disabled={pending}
        >
          {pending ? "Saving…" : "Save academy profile"}
        </Button>
      </div>
    </form>
  );
}
