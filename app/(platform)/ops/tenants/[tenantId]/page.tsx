import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantDetail } from "@/db/platform-tenants";
import { getSampleDataState } from "@/db/sample-data-state";
import { asTenantId } from "@/lib/ids";
import { runOpsRead } from "@/lib/auth/ops-operation";
import { InviteOwnerForm } from "./invite-owner-form";
import { RemoveSampleDataButton } from "./remove-sample-data-button";
import { StatusTransitionControls } from "./status-transitions";
import { DATE_FMT, DATETIME_FMT, SectionHeader, DescriptionRow, StatCard } from "./tenant-detail-shared";

// PR4 (ops console improvements) — the Overview tab. Status, settings,
// stats and the owner-invite action — the things an operator checks
// or acts on first. Locations, entitlements, messaging and the
// activity log each moved to their own tab (see layout.tsx).
//
// Ops redesign (28 October 2026): the write permission is resolved on
// the SERVER from the session role and handed to the mutating islands.
// A viewer sees the tenant's state and the reason it cannot change it,
// never a control that would fail on submit. The server still refuses
// a forged write either way — this is the console's half of the
// boundary, not the enforcement.
export default async function PlatformTenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const auth = await platformAuthStatusAction();
  if (auth.kind !== "authenticated") redirect("/ops/login");
  const canWrite = auth.role === "admin";

  const { tenantId } = await params;
  const detail = await runOpsRead(
    "tenant.detail",
    tenantId,
    () => getTenantDetail(asTenantId(tenantId)),
    "ops_page",
  );
  if (!detail) notFound();
  // The sample-data state is its own operation. The id here is already a
  // validated tenant, so this boundary can never be the "invalid" one.
  const sampleState = await runOpsRead(
    "tenant.sample_data.state",
    detail.id,
    () => getSampleDataState(detail.id),
    "ops_page",
  );
  if (!sampleState) notFound();

  return (
    <>
      <section>
        <SectionHeader
          title="Status"
          subtitle="Suspends and reactivations take effect immediately and write to the audit log."
        />
        <div className="rounded-card border border-line bg-paper px-4 py-3">
          <StatusTransitionControls
            tenantId={detail.id}
            currentStatus={detail.status}
            canWrite={canWrite}
          />
        </div>
      </section>

      <section className="mt-8">
        <SectionHeader title="Settings" />
        <div className="rounded-card border border-line bg-paper">
          <DescriptionRow label="Timezone" value={detail.timezone} />
          <DescriptionRow label="Currency" value={detail.currency} />
          <DescriptionRow label="GSTIN" value={detail.gstin ?? "—"} mono />
          {/* Ops redesign (28 October 2026): the plan row used to link
              to a plans route that does not exist — every click was a
              dead end. The plan is a label here; the operator filters
              the tenant list by plan instead. */}
          <DescriptionRow label="Plan" value={detail.planName ?? "—"} />
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
            value={`${DATE_FMT.format(detail.createdAt)} · updated ${DATETIME_FMT.format(detail.updatedAt)} IST`}
          />
        </div>
      </section>

      {detail.presetKey === null ? (
        <section className="mt-8">
          <SectionHeader
            title="No preset applied"
            subtitle="This tenant has no onboarding preset, so its programs, batches and levels were not seeded."
          />
          <div className="rounded-card border border-line bg-paper px-4 py-3">
            <p className="text-[13px] text-ink-2">
              Apply one from the{" "}
              <Link
                href="/ops/presets"
                className="text-[var(--accent-ink)] underline underline-offset-2"
              >
                preset catalogue
              </Link>{" "}
              before adding real data. Applying is idempotent, so retrying
              after a failed attempt is safe.
            </p>
          </div>
        </section>
      ) : null}

      <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
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
        <div className="rounded-card border border-line bg-paper px-5 py-5">
          <InviteOwnerForm tenantId={detail.id} canWrite={canWrite} />
        </div>
      </section>

      {sampleState.hasSample && !sampleState.hasReal ? (
        <section className="mt-8">
          <SectionHeader
            title="Sample data"
            subtitle="The preset engine seeded this tenant with example programs, batches, and supporting rows. They are flagged is_sample so you can wipe them with one click before adding real data. Once a real (non-sample) program or batch exists, the button hides — edit by hand from then on."
          />
          <div className="rounded-card border border-line bg-paper px-4 py-3">
            <p className="text-[13px] text-ink-2">
              This tenant still has only preset-seeded sample data.
            </p>
            <RemoveSampleDataButton tenantId={detail.id} canWrite={canWrite} />
          </div>
        </section>
      ) : null}
    </>
  );
}
