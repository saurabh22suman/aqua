"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createLeadAction } from "@/lib/actions/platform-leads";
import type { LeadMutationResult } from "@/db/platform-leads";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { OpsCard, OpsPanel } from "@/components/ops/ops-primitives";

// O-10 — lead intake. The qualification fields are the questions the
// sales conversation already asks; capturing them here is what removes
// onboarding re-entry later.
//
// Ops redesign (28 October 2026): every control is the SHARED control
// (Input, Select, Checkbox, Button), so the console's forms carry the
// approved 48px height, 10px radius, 16px control text and the
// neutral-entry / tinted-picker surfaces — the same controls the
// tenant workspace uses.

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
    <form action={formAction} method="post" suppressHydrationWarning className="mt-6 space-y-5">
      <OpsCard className="p-5">
        <h2 className="font-display text-[16px] font-semibold text-ink">Contact</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">
              Business name
            </span>
            <Input name="businessName" required maxLength={200} />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Contact name
              </span>
              <Input name="contactName" required maxLength={200} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Phone
              </span>
              <Input name="phone" required maxLength={40} inputMode="tel" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                City
              </span>
              <Input name="city" maxLength={120} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Source
              </span>
              <Select name="source" defaultValue="whatsapp">
                <option value="website">Website form</option>
                <option value="phone">Phone</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="referral">Referral</option>
                <option value="other">Other</option>
              </Select>
            </label>
          </div>
        </div>
      </OpsCard>

      <OpsCard className="p-5">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Qualification
        </h2>
        <p className="mt-1 text-[13px] text-ink-3">
          These answers select the tenant&apos;s preset and seed its
          configuration at conversion. Skip anything not discussed.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">
              Sport
            </span>
            <Input
              name="sport"
              maxLength={80}
              placeholder="swimming, badminton, gym…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">
              Members
            </span>
            <Select name="memberCountBand" defaultValue="">
              <option value="">Not discussed</option>
              <option value="<50">Under 50</option>
              <option value="50-150">50–150</option>
              <option value="150-400">150–400</option>
              <option value="400+">400+</option>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">
              Fee model
            </span>
            <Select name="feeModel" defaultValue="">
              <option value="">Not discussed</option>
              <option value="monthly">Monthly</option>
              <option value="per_hour">Per hour</option>
              <option value="both">Both</option>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">
              Collections
            </span>
            <Select name="collectionMode" defaultValue="">
              <option value="">Not discussed</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="both">Both</option>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">
              Coaches
            </span>
            <Input name="coachCount" type="number" min={0} max={500} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">
              Locations
            </span>
            <Input name="locations" type="number" min={1} max={50} />
          </label>
        </div>
        <div className="mt-4">
          <Checkbox name="gstRegistered">The club is GST registered</Checkbox>
        </div>
      </OpsCard>

      {error ? (
        <OpsPanel tone="error" title="The lead was not saved">
          {error}
        </OpsPanel>
      ) : null}
      {saved ? (
        <OpsPanel tone="info" title="Lead saved">
          <Link
            href="/ops/leads"
            className="text-[var(--accent-ink)] underline underline-offset-2"
          >
            Back to the pipeline
          </Link>
        </OpsPanel>
      ) : null}

      <Button type="submit" variant="primary" disabled={isPending}>
        {isPending ? "Saving…" : "Save lead"}
      </Button>
    </form>
  );
}
