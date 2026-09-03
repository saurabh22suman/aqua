import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";

// Operator landing screen after a successful 2FA. The substantive
// surfaces (tenant list, tenant detail, create-tenant, status
// lifecycle, feature catalogue, activity log) are linked from
// here — this page exists to give a logged-in operator the
// obvious next move rather than a dead-end with content
// scattered elsewhere.
export default async function PlatformHome() {
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") {
    redirect("/platform/login");
  }
  if (status.kind === "unauthenticated") redirect("/platform/verify");

  return (
    <div className="max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Overview
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        Aqua control plane
      </h1>
      <p className="mt-2 text-[15px] text-ink-2">
        Signed in as <span className="font-medium">{status.role}</span>.
      </p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/platform/tenants"
          className="rounded-card bg-paper border border-line p-4 hover:border-[var(--accent)] transition-colors duration-150"
        >
          <p className="text-[13px] font-medium text-ink">Tenants</p>
          <p className="mt-1 text-[12px] text-ink-3">
            List every tenant, drill into settings, suspend or churn.
          </p>
        </Link>
        <Link
          href="/platform/features"
          className="rounded-card bg-paper border border-line p-4 hover:border-[var(--accent)] transition-colors duration-150"
        >
          <p className="text-[13px] font-medium text-ink">Feature catalogue</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Editable list of every feature Aqua ships.
          </p>
        </Link>
        <Link
          href="/platform/activity"
          className="rounded-card bg-paper border border-line p-4 hover:border-[var(--accent)] transition-colors duration-150"
        >
          <p className="text-[13px] font-medium text-ink flex items-center gap-1.5">
            <Activity size={13} strokeWidth={2} /> Activity log
          </p>
          <p className="mt-1 text-[12px] text-ink-3">
            Append-only cross-tenant audit trail across every operator action.
          </p>
        </Link>
      </div>
    </div>
  );
}
