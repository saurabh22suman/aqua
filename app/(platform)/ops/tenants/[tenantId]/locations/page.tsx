import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { asTenantId } from "@/lib/ids";
import { requireUuidParam } from "@/lib/params";
import { DATE_FMT, SectionHeader } from "../tenant-detail-shared";

// PR4 (ops console improvements) — Locations tab, moved verbatim from
// the Overview page's single scroll.
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
        <div className="rounded-card bg-paper border border-line px-5 py-8 text-center">
          <p className="text-[14px] font-medium text-ink">No locations yet</p>
          <p className="mt-2 text-[13px] text-ink-3">
            New tenants ship with one location from the create-tenant
            form. Adding more is part of the onboarding wizard.
          </p>
        </div>
      ) : (
        <div className="rounded-card bg-paper border border-line overflow-hidden">
          <ul>
            {detail.locations.map((loc) => (
              <li
                key={loc.id}
                className="flex items-center justify-between px-4 py-3 border-b border-line last:border-b-0"
              >
                <div>
                  <p className="text-[14px] font-medium text-ink">{loc.name}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    Added {DATE_FMT.format(loc.createdAt)}
                  </p>
                </div>
                {loc.isPrimary ? (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-pill bg-water-soft text-water">
                    Primary
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
