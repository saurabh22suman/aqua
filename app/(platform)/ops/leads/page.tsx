import Link from "next/link";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listLeads } from "@/db/platform-leads";

// O-10 (docs/ops-platform-design.md §7) — the sales pipeline list.

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});

const STATUS_TONE: Record<string, string> = {
  lead: "bg-deck text-ink-2",
  qualified: "bg-marine/10 text-marine",
  demo_booked: "bg-marine/10 text-marine",
  trial: "bg-marine/10 text-marine",
  converted: "bg-marine/10 text-marine",
  lapsed: "bg-deck text-ink-3",
  lost: "bg-deck text-ink-3",
};

export default async function LeadsPage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");

  const leads = await listLeads();

  return (
    <div className="max-w-4xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link href="/ops" className="hover:text-ink underline-offset-2 hover:underline">
          Overview
        </Link>
        {" / "}
        leads
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <h1 className="font-display text-[28px] font-semibold text-marine">Leads</h1>
        <Link
          href="/ops/leads/new"
          className="rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90"
        >
          New lead
        </Link>
      </div>
      <p className="mt-1 text-[14px] text-ink-2">
        A lead is a club approaching the platform. Its qualification
        answers become the tenant&apos;s preset and configuration at
        conversion — nothing is re-entered.
      </p>

      {leads.length === 0 ? (
        <p className="mt-6 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
          No leads yet. Capture the next conversation from{" "}
          <Link href="/ops/leads/new" className="text-[var(--accent-ink)] underline underline-offset-2">
            New lead
          </Link>
          .
        </p>
      ) : (
        <div className="mt-6 rounded-card bg-paper border border-line overflow-hidden">
          {leads.map((lead) => (
            <Link
              key={lead.id}
              href={`/ops/leads/${lead.id}`}
              className="block border-b border-line last:border-b-0 px-4 py-3 hover:bg-deck"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[14px] font-medium text-ink">
                  {lead.businessName}
                </span>
                <span
                  className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                    STATUS_TONE[lead.status] ?? "bg-deck text-ink-2"
                  }`}
                >
                  {lead.status.replace("_", " ")}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {lead.contactName} · {lead.phone}
                {lead.city ? ` · ${lead.city}` : ""} · via {lead.source} ·{" "}
                {DATE_FMT.format(lead.createdAt)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
