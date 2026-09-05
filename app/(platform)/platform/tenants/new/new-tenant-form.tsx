"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createTenantAction,
  type CreateTenantResult,
} from "@/lib/actions/platform-tenants";

// Phase 1.5 — create-tenant form. H1 — uses <form action={createTenantAction}>
// rather than onSubmit. Pre-hydration submit goes via POST to the
// action endpoint; form fields (name, slug, timezone, currency,
// GSTIN, locationName) never appear as query-string values.

type Plan = { key: string; name: string; isDefault: boolean };

export function NewTenantForm({
  defaultTimezone,
  defaultCurrency,
  defaultLocationName,
  plans,
  defaultPlanKey,
}: {
  defaultTimezone: string;
  defaultCurrency: string;
  defaultLocationName: string;
  plans: ReadonlyArray<Plan>;
  defaultPlanKey: string;
}) {
  const [state, formAction, isPending] = useActionState(createTenantAction, {
    kind: "error",
    code: "invalid",
    message: "",
  } as CreateTenantResult);

  const error = state?.kind === "error" ? state.message : null;

  return (
    <form action={formAction} method="post" className="mt-8 space-y-6">
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
        subtitle="Defaults applied unless the operator overrides."
      >
        <Field
          label="Time zone"
          name="timezone"
          required
          defaultValue={defaultTimezone}
          autoComplete="off"
          hint="IANA identifier, e.g. Asia/Kolkata."
        />
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
          label="Currency"
          name="currency"
          required
          defaultValue={defaultCurrency}
          autoComplete="off"
          pattern="[A-Z]{3}"
          maxLength={3}
          hint="ISO 4217, three uppercase letters."
        />
        <Field
          label="GSTIN"
          name="gstin"
          autoComplete="off"
          maxLength={15}
          hint="15-character GSTIN. Optional for non-India tenants."
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
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="locationIsPrimary"
            defaultChecked
            className="h-5 w-5 rounded border border-line text-[var(--accent)] focus:ring-[var(--accent)]"
          />
          <span className="text-[14px] text-ink-2">
            This is the primary location
          </span>
        </label>
      </Section>

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
          type="submit"
          disabled={isPending}
          className="rounded-pill px-6 py-3 text-[14px] font-semibold text-white bg-[var(--accent)] transition-colors duration-150 disabled:opacity-60"
        >
          {isPending ? "Creating…" : "Create tenant"}
        </button>
        <Link
          href="/platform/tenants"
          className="rounded-pill px-4 py-3 text-[13px] font-medium text-ink-2 hover:text-ink hover:underline"
        >
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
    <section className="rounded-card bg-paper border border-line p-5 space-y-4">
      <div>
        <h2 className="font-display text-[16px] font-semibold text-ink">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-[13px] text-ink-3">{subtitle}</p>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
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
      <span className="block text-[13px] font-medium text-ink-2">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        pattern={pattern}
        maxLength={maxLength}
        className="mt-1 w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink placeholder:text-ink-3 focus:border-[var(--accent)] focus:outline-none"
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
      <span className="block text-[13px] font-medium text-ink-2">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent)] focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}