import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantHeader } from "@/db/platform-tenants";
import { getTenantMessagingSummary } from "@/db/platform-tenant-messaging";
import { asTenantId } from "@/lib/ids";
import { requireUuidParam } from "@/lib/params";
import { SectionHeader, DescriptionRow, DATETIME_FMT } from "../tenant-detail-shared";

const PROVIDER_LABEL: Record<string, string> = {
  mock: "Non-production mock",
  cloud: "WhatsApp Cloud API",
};

// PR4 (ops console improvements) — Messaging tab: this tenant's
// WhatsApp connection state. C-40a ships a provider abstraction with
// a non-production mock; there is no per-tenant WABA onboarding
// record yet (that lands with C-40's real Cloud API adapter), so
// "connected" here means "has sent at least one message" via
// whichever provider actually handled it — not a stored connection
// flag, because no such flag exists to read.
export default async function TenantMessagingPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const auth = await platformAuthStatusAction();
  if (auth.kind !== "authenticated") redirect("/ops/login");

  const { tenantId } = await params;
  requireUuidParam(tenantId);
  const header = await getTenantHeader(asTenantId(tenantId));
  if (!header) notFound();
  const summary = await getTenantMessagingSummary(header.id);

  return (
    <section>
      <SectionHeader
        title="Messaging"
        subtitle="WhatsApp connection state for this tenant. No credentials or message content are shown here."
      />
      <div className="rounded-card bg-paper border border-line overflow-hidden">
        <DescriptionRow
          label="Provider"
          value={
            summary.provider
              ? (PROVIDER_LABEL[summary.provider] ?? summary.provider)
              : "Not connected — no messages sent yet"
          }
        />
        <DescriptionRow
          label="Last message sent"
          value={summary.lastSentAt ? DATETIME_FMT.format(summary.lastSentAt) : "—"}
        />
        <DescriptionRow
          label="Sent, last 7 days"
          value={String(summary.sentCount7d)}
        />
        <DescriptionRow
          label="Failed, last 7 days"
          value={String(summary.failedCount7d)}
        />
      </div>
    </section>
  );
}
