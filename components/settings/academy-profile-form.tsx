"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
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
        <Input id="academy-name" type="text" {...field("name")}  />
      </label>

      <label className="block" htmlFor="academy-currency">
        <span className="block text-[13px] font-medium text-ink-2">Currency</span>
        <Input
          id="academy-currency"
          type="text"
          maxLength={3}
          {...field("currency")}
          
        />
        <span className="mt-1 block text-[12px] text-ink-3">
          ISO 4217, three uppercase letters.
        </span>
      </label>

      <label className="block" htmlFor="academy-timezone">
        <span className="block text-[13px] font-medium text-ink-2">Time zone</span>
        <Input id="academy-timezone" type="text" {...field("timezone")}  />
        <span className="mt-1 block text-[12px] text-ink-3">
          IANA identifier, e.g. Asia/Kolkata.
        </span>
      </label>

      <label className="block" htmlFor="academy-gstin">
        <span className="block text-[13px] font-medium text-ink-2">
          GSTIN (optional)
        </span>
        <Input
          id="academy-gstin"
          type="text"
          maxLength={15}
          {...field("gstin")}
          
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
        <Button
          variant="primary"
          size="md"
          className="inline-flex items-center justify-center"
          type="button"
          onClick={submit}
          disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
        {savedAt ? (
          <p role="status" className="text-[12.5px] text-ink-2">
            Saved.
          </p>
        ) : null}
      </div>
    </div>
  );
}
