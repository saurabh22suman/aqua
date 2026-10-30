"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createTenantAction,
  type CreateTenantResult,
} from "@/lib/actions/platform-tenants";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { OpsCard, OpsPanel } from "@/components/ops/ops-primitives";

// Phase 1.5 — create-tenant form. H1 — uses <form action={createTenantAction}>
// rather than onSubmit. Pre-hydration submit goes via POST to the
// action endpoint; form fields (name, slug, timezone, currency,
// GSTIN, locationName) never appear as query-string values.
//
// India-first (29 October 2026): NEW tenants are created with INR and IST. The
// values are submitted as hidden fields so the existing server contract is
// unchanged; the operator sees plain India context, not an ISO/IANA input.
// Existing tenant records keep their stored currency and time zone.

type Plan = { key: string; name: string; isDefault: boolean };
type Preset = { key: string; name: string; description: string };

export function NewTenantForm({
  defaultLocationName,
  plans,
  defaultPlanKey,
  presets,
  defaultPresetKey,
}: {
  // Kept for the page's create-tenant contract; the form no longer edits these.
  defaultTimezone: string;
  defaultCurrency: string;
  defaultLocationName: string;
  plans: ReadonlyArray<Plan>;
  defaultPlanKey: string;
  presets: ReadonlyArray<Preset>;
  defaultPresetKey: string;
}) {
  const [state, formAction, isPending] = useActionState(createTenantAction, {
    kind: "error",
    code: "invalid",
    message: "",
  } as CreateTenantResult);

  const error = state?.kind === "error" ? state.message : null;

  return (
    // method="post" is pinned by scripts/e2e-platform-form-leak.ts;
    // suppress the case-only hydration warning React raises for
    // server-action forms (POST vs post).
    <form action={formAction} method="post" suppressHydrationWarning className="mt-8 space-y-6">
      <Section title="Club details" subtitle="Public-facing name and URL slug.">
        <Field label="Club name" name="name" required autoComplete="off" />
        <Field
          label="Slug"
          name="slug"
          required
          autoComplete="off"
          pattern="[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?"
          hint="Lowercase letters, numbers, hyphens. Used in the tenant URL."
        />
      </Section>

      <Section
        title="Settings"
        subtitle="New tenants are created with INR and Indian Standard Time."
      >
        <div className="rounded-ctl border border-line bg-deck px-3 py-2">
          <p className="text-[13px] font-medium text-ink">Currency · INR</p>
          <p className="mt-0.5 text-[12px] text-ink-3">
            This new tenant is created with Indian rupees.
          </p>
        </div>
        <div className="rounded-ctl border border-line bg-deck px-3 py-2">
          <p className="text-[13px] font-medium text-ink">
            Time zone · Indian Standard Time
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3">
            This new tenant uses IST (UTC+05:30).
          </p>
        </div>
        <input type="hidden" name="timezone" value="Asia/Kolkata" />
        <input type="hidden" name="currency" value="INR" />
        <SelectField
          label="Plan"
          name="planKey"
          defaultValue={defaultPlanKey}
          options={plans.map((p) => ({
            value: p.key,
            label: p.isDefault ? `${p.name} (default)` : p.name,
          }))}
        />
        <Field
          label="GSTIN"
          name="gstin"
          autoComplete="off"
          maxLength={15}
          hint="15-character GSTIN. Optional."
        />
      </Section>

      <Section
        title="Onboarding preset"
        subtitle="Seeds the tenant's programs, batches and levels. Applying is idempotent, so a failed apply can be retried from the preset catalogue."
      >
        <SelectField
          label="Preset"
          name="presetKey"
          defaultValue={defaultPresetKey}
          options={presets.map((p) => ({
            value: p.key,
            label: `${p.name} (${p.key})`,
          }))}
        />
      </Section>

      <Section
        title="First location"
        subtitle="Every tenant starts with one location. More can be added later."
      >
        <Field
          label="Location name"
          name="locationName"
          required
          defaultValue={defaultLocationName}
          autoComplete="off"
        />
        <Checkbox name="locationIsPrimary" defaultChecked>
          This is the primary location
        </Checkbox>
      </Section>

      {error ? (
        <OpsPanel tone="error" role="alert">
          {error}
        </OpsPanel>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? "Creating…" : "Create tenant"}
        </Button>
        <Link href="/ops/tenants" className={buttonClasses({ variant: "secondary" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <OpsCard className="space-y-4 p-5">
      <div>
        <h2 className="font-display text-[16px] font-semibold text-ink">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-[13px] text-ink-3">{subtitle}</p>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </OpsCard>
  );
}

function Field({
  label,
  name,
  hint,
  type = "text",
  required,
  defaultValue,
  autoComplete,
  pattern,
  maxLength,
}: {
  label: string;
  name: string;
  hint?: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  autoComplete?: string;
  pattern?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-ink-2">{label}</span>
      <Input
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        pattern={pattern}
        maxLength={maxLength}
      />
      {hint ? (
        <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-ink-2">{label}</span>
      <Select name={name} defaultValue={defaultValue}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    </label>
  );
}