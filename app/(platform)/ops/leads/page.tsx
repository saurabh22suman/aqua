import Link from "next/link";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listLeads } from "@/db/platform-leads";
import { Button, buttonClasses } from "@/components/ui/Button";
import type { StatusTone } from "@/components/ui/StatusBadge";
import { Select } from "@/components/ui/Select";
import {
  OpsEmptyState,
  OpsPage,
  OpsPageHeader,
} from "@/components/ops/ops-primitives";
import { OpsStatusPill } from "@/components/ops/ops-display";
import { OpsList, OpsListRow, OpsToolbar } from "@/components/ops/ops-table";

// O-10 (docs/ops-platform-design.md §7) — the sales pipeline list.
//
// Ops redesign (28 October 2026): the pipeline can be narrowed by
// stage — the one thing an operator filters by ("show me the trials").
// The stage set is the platform's OWN (db/platform-leads.ts), so the
// picker cannot offer a stage the pipeline does not have.
//
// The filter is a GET form, so the stage is in the URL: the operator
// can copy it, and Back returns to the whole pipeline. The count line
// says how many of the loaded leads match, so a filtered list never
// reads as the whole pipeline.

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});

/** The platform's own lead stages (db/platform-leads.ts). */
const STAGES = [
  { value: "", label: "All stages" },
  { value: "lead", label: "Lead" },
  { value: "qualified", label: "Qualified" },
  { value: "demo_booked", label: "Demo booked" },
  { value: "trial", label: "Trial" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
  { value: "lapsed", label: "Lapsed" },
] as const;

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

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");

  const { stage } = await searchParams;
  const selectedStage = STAGES.some((s) => s.value === stage) ? stage ?? "" : "";
  const leads = await listLeads();
  const rows = selectedStage
    ? leads.filter((lead) => lead.status === selectedStage)
    : leads;
  const stageLabel =
    STAGES.find((s) => s.value === selectedStage)?.label.toLowerCase() ?? "";

  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Overview / leads"
        title="Leads"
        lede="A lead is a club approaching the platform. Its qualification answers become the tenant’s preset and configuration at conversion — nothing is re-entered."
        actions={
          <Link
            href="/ops/leads/new"
            className={buttonClasses({ variant: "primary" })}
          >
            New lead
          </Link>
        }
      />

      <OpsToolbar
        className="mt-6"
        layout="inline"
        actions={
          <>
            <Button type="submit" variant="primary">
              Apply
            </Button>
            {selectedStage ? (
              <Link
                href="/ops/leads"
                className={buttonClasses({ variant: "secondary" })}
              >
                Clear
              </Link>
            ) : null}
          </>
        }
      >
        <label className="block min-w-0 flex-1 sm:max-w-xs">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">
            Stage
          </span>
          <Select name="stage" defaultValue={selectedStage}>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
      </OpsToolbar>

      <p className="mt-4 text-[13px] text-ink-2">
        {selectedStage
          ? `${rows.length} of ${leads.length} leads match the ${stageLabel} stage.`
          : `${leads.length} ${leads.length === 1 ? "lead" : "leads"} in the pipeline.`}
      </p>

      {rows.length === 0 ? (
        <OpsEmptyState
          className="mt-4"
          title={
            selectedStage
              ? `No leads in the ${stageLabel} stage.`
              : "No leads yet."
          }
          body={
            selectedStage
              ? "Clear the stage filter to see the whole pipeline."
              : "Capture the next conversation from New lead."
          }
        />
      ) : (
        <OpsList className="mt-4">
          {rows.map((lead) => (
            <OpsListRow key={lead.id} className="block">
              <Link
                href={`/ops/leads/${lead.id}`}
                className="block w-full text-ink no-underline"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[14px] font-medium text-ink">
                    {lead.businessName}
                  </span>
                  <OpsStatusPill tone={STATUS_TONE[lead.status] ?? "neutral"}>
                    {STATUS_LABEL[lead.status] ?? lead.status}
                  </OpsStatusPill>
                </div>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {lead.contactName} · {lead.phone}
                  {lead.city ? ` · ${lead.city}` : ""} · via {lead.source} ·{" "}
                  {DATE_FMT.format(lead.createdAt)}
                </p>
              </Link>
            </OpsListRow>
          ))}
        </OpsList>
      )}
    </OpsPage>
  );
}
