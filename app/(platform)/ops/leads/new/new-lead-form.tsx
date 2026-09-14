"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createLeadAction,
} from "@/lib/actions/platform-leads";
import type { LeadMutationResult } from "@/db/platform-leads";

// O-10 — lead intake. The qualification fields are the questions the
// sales conversation already asks; capturing them here is what removes
// onboarding re-entry later.

const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink focus:border-[var(--accent)] focus:outline-none";

export function NewLeadForm() {
  const [state, formAction, isPending] = useActionState(createLeadAction, {
    kind: "error",
    code: "invalid",
    message: "",
  } as LeadMutationResult);

  const error =
    state.kind === "error" && state.message.length > 0 ? state.message : null;
  const saved = state.kind === "ok";

  return (
    <form action={formAction} method="post" suppressHydrationWarning className="mt-6 space-y-6">
      <section className="rounded-card bg-paper border border-line p-5 space-y-4">
        <h2 className="font-display text-[16px] font-semibold text-ink">Contact</h2>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">Business name</span>
          <input name="businessName" required maxLength={200} className={inputClass} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">Contact name</span>
            <input name="contactName" required maxLength={200} className={inputClass} />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">Phone</span>
            <input name="phone" required maxLength={40} inputMode="tel" className={inputClass} />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">City</span>
            <input name="city" maxLength={120} className={inputClass} />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">Source</span>
            <select name="source" defaultValue="whatsapp" className={inputClass}>
              <option value="website">Website form</option>
              <option value="phone">Phone</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="referral">Referral</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-card bg-paper border border-line p-5 space-y-4">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Qualification
        </h2>
        <p className="text-[12px] text-ink-3">
          These answers select the tenant&apos;s preset and seed its
          configuration at conversion. Skip anything not discussed.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">Sport</span>
            <input name="sport" maxLength={80} placeholder="swimming, badminton, gym…" className={inputClass} />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">Members</span>
            <select name="memberCountBand" defaultValue="" className={inputClass}>
              <option value="">Not discussed</option>
              <option value="<50">Under 50</option>
              <option value="50-150">50–150</option>
              <option value="150-400">150–400</option>
              <option value="400+">400+</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">Fee model</span>
            <select name="feeModel" defaultValue="" className={inputClass}>
              <option value="">Not discussed</option>
              <option value="monthly">Monthly</option>
              <option value="per_hour">Per hour</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">Collections</span>
            <select name="collectionMode" defaultValue="" className={inputClass}>
              <option value="">Not discussed</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">Coaches</span>
            <input name="coachCount" type="number" min={0} max={500} className={inputClass} />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-ink-2 mb-1">Locations</span>
            <input name="locations" type="number" min={1} max={50} className={inputClass} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" name="gstRegistered" className="h-4 w-4" />
          GST registered
        </label>
      </section>

      {error ? (
        <p role="alert" className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2">
          Lead saved.{" "}
          <Link href="/ops/leads" className="text-[var(--accent)] underline underline-offset-2">
            Back to the pipeline
          </Link>
          .
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-pill px-6 py-2.5 text-[14px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? "Saving…" : "Save lead"}
      </button>
    </form>
  );
}
