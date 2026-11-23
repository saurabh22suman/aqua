import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { asTenantId } from "@/lib/ids";
import { runOpsRead } from "@/lib/auth/ops-operation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DATE_FMT } from "../tenant-detail-shared";
import { OpsPageHeader, OpsCardFlush, OpsEmptyState } from "@/components/ops/ops-primitives";

export const metadata: Metadata = { title: "Tenant locations" };

// PR4 (ops console improvements) — Locations tab, moved verbatim from
// the Overview page's single scroll.
//
// Ops redesign (28 October 2026): the tab's body is the shared Ops
// frame — one empty state, one divided list, one status pill.
export default async function TenantLocationsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const auth = await platformAuthStatusAction();
  if (auth.kind !== "authenticated") redirect("/ops/login");

  const { tenantId } = await params;
  const detail = await runOpsRead(
    "tenant.detail",
    tenantId,
    () => getTenantDetail(asTenantId(tenantId)),
    "ops_page",
  );
  if (!detail) notFound();

  return (
    <section className="space-y-4">
      <OpsPageHeader title="Locations" lede={`${detail.locations.length} ${detail.locations.length === 1 ? "active location" : "active locations"}`} />
      {detail.locations.length === 0 ? (
        <OpsEmptyState
          title="No locations yet"
          body="New tenants ship with one location from the create-tenant form. Adding more is part of the onboarding wizard."
        />
      ) : (
        <OpsCardFlush>
          <ul>
            {detail.locations.map((loc) => (
              <li
                key={loc.id}
                className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">{loc.name}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    Added {DATE_FMT.format(loc.createdAt)}
                  </p>
                </div>
                {loc.isPrimary ? (
                  <StatusBadge tone="neutral">Primary</StatusBadge>
                ) : null}
              </li>
            ))}
          </ul>
        </OpsCardFlush>
      )}
    </section>
  );
}
