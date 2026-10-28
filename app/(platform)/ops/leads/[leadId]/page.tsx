import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getLead } from "@/db/platform-leads";
import { presetForQualification } from "@/db/platform-lead-conversion";
import { listPresets } from "@/db/platform-presets";
import type { StatusTone } from "@/components/ui/StatusBadge";
import { LeadActions } from "./lead-actions";
import {
  OpsCardFlush,
  OpsEmptyState,
  OpsPage,
  OpsPageHeader,
} from "@/components/ops/ops-primitives";
import { OpsStatusPill } from "@/components/ops/ops-display";

// O-10 (docs/ops-platform-design.md §7) — one lead: the qualification
// record, the lifecycle controls and the conversion action.
//
// Ops redesign (28 October 2026): the page is the shared Ops frame, and
// the write permission is resolved on the server from the session role.

const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const STATUS_LABEL: Record<string, string> = {
  lead: "Lead",
  qualified: "Qualified",
  demo_booked: "Demo booked",
  trial: "Trial",
  converted: "Converted",
  lapsed: "Lapsed",
  lost: "Lost",
};

const STATUS_TONE: Record<string, StatusTone> = {
  lead: "neutral",
  qualified: "water",
  demo_booked: "water",
  trial: "water",
  converted: "good",
  lapsed: "neutral",
  lost: "late",
} as const;

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
  const canWrite = status.role === "admin";

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
    <OpsPage className="max-w-[760px]">
      <OpsPageHeader
        eyebrow={`Leads / ${lead.businessName}`}
        title={lead.businessName}
        lede={
          <>
            {lead.contactName} · {lead.phone}
            {lead.email ? ` · ${lead.email}` : ""}
            {lead.city ? ` · ${lead.city}` : ""} · via {lead.source}
          </>
        }
        actions={
          <OpsStatusPill tone={STATUS_TONE[lead.status] ?? "neutral"}>
            {STATUS_LABEL[lead.status] ?? lead.status}
          </OpsStatusPill>
        }
      />

      <OpsCardFlush className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
          <span className="text-[13px] text-ink-2">
            Added {DATETIME_FMT.format(lead.createdAt)} IST
          </span>
        </div>
        {lead.lostReason ? (
          <div className="border-b border-line px-4 py-3">
            <span className="text-[12px] text-ink-3">Lost reason: {lead.lostReason}</span>
          </div>
        ) : null}
        {lead.trialExpiresAt ? (
          <div className="border-b border-line px-4 py-3">
            <span className="text-[12px] text-ink-3">
              Trial expires {DATETIME_FMT.format(lead.trialExpiresAt)} IST
            </span>
          </div>
        ) : null}
        {lead.convertedTenantId ? (
          <div className="px-4 py-3">
            <span className="text-[12px] text-ink-3">
              Tenant:{" "}
              <Link
                href={`/ops/tenants/${lead.convertedTenantId}`}
                className="text-[var(--accent-ink)] underline underline-offset-2"
              >
                {lead.convertedTenantId}
              </Link>
            </span>
          </div>
        ) : null}
      </OpsCardFlush>

      <section className="mt-8">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
          Qualification answers
        </h2>
        {qualification.length === 0 ? (
          <OpsEmptyState
            className="mt-2"
            title="Nothing captured"
            body="The preset will fall back to start-from-scratch."
          />
        ) : (
          <OpsCardFlush className="mt-2">
            {qualification.map(([key, value]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
              >
                <span className="text-[12px] text-ink-3">{key}</span>
                <span className="text-[13px] font-medium text-ink">
                  {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
                </span>
              </div>
            ))}
          </OpsCardFlush>
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
          canWrite={canWrite}
        />
      </div>
    </OpsPage>
  );
}
