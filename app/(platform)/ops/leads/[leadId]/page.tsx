import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getLead } from "@/db/platform-leads";
import { presetForQualification } from "@/db/platform-lead-conversion";
import { listPresets } from "@/db/platform-presets";
import { LeadActions } from "./lead-actions";

// O-10 (docs/ops-platform-design.md §7) — one lead: the qualification
// record, the lifecycle controls and the conversion action.

const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");

  const { leadId } = await params;
  const lead = await getLead(leadId);
  if (!lead) notFound();

  const [presetResult] = await Promise.all([listPresets()]);
  const presetOptions = presetResult
    .filter((preset) => preset.status === "active")
    .map((preset) => ({ key: preset.key, name: preset.name }));
  const defaultPreset = presetForQualification(lead.qualification);

  const qualification = Object.entries(lead.qualification).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );

  return (
    <div className="max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link href="/ops/leads" className="hover:text-ink underline-offset-2 hover:underline">
          Leads
        </Link>
        {" / "}
        {lead.businessName}
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        {lead.businessName}
      </h1>
      <p className="mt-1 text-[14px] text-ink-2">
        {lead.contactName} · {lead.phone}
        {lead.email ? ` · ${lead.email}` : ""}
        {lead.city ? ` · ${lead.city}` : ""} · via {lead.source}
      </p>

      <section className="mt-6 rounded-card bg-paper border border-line px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[13px] text-ink">
            Status: <span className="font-medium">{lead.status}</span>
          </span>
          <span className="text-[12px] text-ink-3">
            Added {DATETIME_FMT.format(lead.createdAt)} IST
          </span>
        </div>
        {lead.lostReason ? (
          <p className="mt-1 text-[12px] text-ink-3">
            Lost reason: {lead.lostReason}
          </p>
        ) : null}
        {lead.trialExpiresAt ? (
          <p className="mt-1 text-[12px] text-ink-3">
            Trial expires {DATETIME_FMT.format(lead.trialExpiresAt)} IST
          </p>
        ) : null}
        {lead.convertedTenantId ? (
          <p className="mt-1 text-[12px] text-ink-3">
            Tenant:{" "}
            <Link
              href={`/ops/tenants/${lead.convertedTenantId}`}
              className="text-[var(--accent)] underline underline-offset-2"
            >
              {lead.convertedTenantId}
            </Link>
          </p>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Qualification answers
        </h2>
        {qualification.length === 0 ? (
          <p className="mt-2 rounded-card bg-paper border border-line px-4 py-3 text-[13px] text-ink-3">
            Nothing captured. The preset will fall back to start-from-scratch.
          </p>
        ) : (
          <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
            {qualification.map(([key, value]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-3 border-b border-line last:border-b-0 px-4 py-2.5"
              >
                <span className="text-[12px] text-ink-3">{key}</span>
                <span className="text-[13px] font-medium text-ink">
                  {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-8">
        <LeadActions
          leadId={lead.id}
          currentStatus={lead.status}
          defaultSlug={slugify(lead.businessName)}
          defaultLocationName={lead.city ?? "Main Location"}
          defaultPreset={defaultPreset}
          presetOptions={presetOptions}
        />
      </div>
    </div>
  );
}
