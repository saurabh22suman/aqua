import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { getSampleDataState } from "@/db/sample-data-state";
import { asTenantId } from "@/lib/ids";
import { requireUuidParam } from "@/lib/params";
import { InviteOwnerForm } from "./invite-owner-form";
import { RemoveSampleDataButton } from "./remove-sample-data-button";
import { StatusTransitionControls } from "./status-transitions";
import { DATE_FMT, DATETIME_FMT, SectionHeader, DescriptionRow, StatCard } from "./tenant-detail-shared";

// PR4 (ops console improvements) — the Overview tab. Status, settings,
// stats and the owner-invite action — the things an operator checks
// or acts on first. Locations, entitlements, messaging and the
// activity log each moved to their own tab (see layout.tsx).
export default async function PlatformTenantDetailPage({
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
  const sampleState = await getSampleDataState(tenantId);

  return (
    <>
      <section>
        <SectionHeader
          title="Status"
          subtitle="Suspends and reactivations take effect immediately and write to the audit log."
        />
        <div className="rounded-card bg-paper border border-line px-4 py-3">
          <StatusTransitionControls
            tenantId={detail.id}
            currentStatus={detail.status}
          />
        </div>
      </section>

      <section className="mt-8">
        <SectionHeader title="Settings" />
        <div className="rounded-card bg-paper border border-line overflow-hidden">
          <DescriptionRow label="Timezone" value={detail.timezone} />
          <DescriptionRow label="Currency" value={detail.currency} />
          <DescriptionRow label="GSTIN" value={detail.gstin ?? "—"} mono />
          <DescriptionRow
            label="Plan"
            value={detail.planName ?? "—"}
            href={detail.planId ? `/ops/plans/${detail.planId}` : undefined}
          />
          <DescriptionRow
            label="Preset"
            value={
              detail.presetKey
                ? `${detail.presetKey} v${detail.presetVersion ?? "?"}`
                : "—"
            }
          />
          <DescriptionRow
            label="Offline sync (per-tenant)"
            value={detail.offlineSyncEnabled ? "Enabled" : "Disabled (default)"}
          />
          <DescriptionRow
            label="Created"
            value={`${DATE_FMT.format(detail.createdAt)} · updated ${DATETIME_FMT.format(detail.updatedAt)}`}
          />
        </div>
      </section>

      <section className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Members" value={detail.memberCount} />
        <StatCard label="Locations" value={detail.locationCount} />
        <StatCard label="Sessions this month" value={detail.sessionsThisMonth} />
      </section>

      {/* 2026-09-13 UI/UX audit X-D6: the Owner block is the one
          genuinely mutable action on this page and was buried below a
          30+ row feature list at the bottom. It now sits directly
          under the identity/status stats. */}
      <section className="mt-8">
        <SectionHeader
          title="Owner"
          subtitle="Step 3 of the onboarding wizard: create the owner's membership, then mint a login link and share it with them yourself. Nothing is delivered automatically."
        />
        <div className="rounded-card bg-paper border border-line px-5 py-5">
          <InviteOwnerForm tenantId={detail.id} />
        </div>
      </section>

      {sampleState.hasSample && !sampleState.hasReal ? (
        <section className="mt-8">
          <SectionHeader
            title="Sample data"
            subtitle="The preset engine seeded this tenant with example programs, batches, and supporting rows. They are flagged is_sample so you can wipe them with one click before adding real data. Once a real (non-sample) program or batch exists, the button hides — edit by hand from then on."
          />
          <div className="rounded-card bg-paper border border-line px-4 py-3">
            <p className="text-[13px] text-ink-2">
              This tenant still has only preset-seeded sample data.
            </p>
            <RemoveSampleDataButton tenantId={detail.id} />
          </div>
        </section>
      ) : null}
    </>
  );
}
