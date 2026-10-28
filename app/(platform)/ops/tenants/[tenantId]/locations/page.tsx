import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { asTenantId } from "@/lib/ids";
import { requireUuidParam } from "@/lib/params";
import { DATE_FMT, SectionHeader } from "../tenant-detail-shared";
import { OpsCardFlush, OpsEmptyState } from "@/components/ops/ops-primitives";

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
  requireUuidParam(tenantId);
  const detail = await getTenantDetail(asTenantId(tenantId));
  if (!detail) notFound();

  return (
    <section>
      <SectionHeader
        title="Locations"
        subtitle={`${detail.locations.length} live · deleted locations hidden`}
      />
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
                  <span className="rounded-pill bg-water-soft px-3 py-1 text-[11px] font-medium text-water">
                    Primary
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </OpsCardFlush>
      )}
    </section>
  );
}
