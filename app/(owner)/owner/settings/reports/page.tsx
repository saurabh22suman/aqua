import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import type { ReportFamily } from "@/lib/owner-reports/preferences";
import { ReportPreferencesEditor } from "@/components/reports/owner-approved/report-preferences";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { cookies } from "next/headers";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";

export default async function ReportPreferencesPage({ searchParams }: { searchParams?: Promise<{ facility?: string }> }) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.operational");
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const facility = resolveFacilityValue(params.facility, cookieStore.get(FACILITY_COOKIE)?.value);
  const reportsHref = `/owner/reports?${new URLSearchParams({ facility: facility ?? "all" })}`;
  if (!hasFeature(ctx, "reports")) return <OwnerPage><BackLink href={reportsHref} label="Reports" /><PageHeader title="Report preferences" purpose="Reports are unavailable." /></OwnerPage>;
  const available: ReportFamily[] = ["attendance", "members", "batches"];
  if (hasPermission(ctx, "staff.attendance")) available.push("staff");
  if (hasPermission(ctx, "reports.financial") && hasPermission(ctx, "invoices.read") && hasFeature(ctx, "billing")) available.push("collections");
  const terminology = await getTerminologyAction();
  return <OwnerPage>
    <BackLink href={reportsHref} label="Reports" />
    <PageHeader title="Report preferences" />
    <ReportPreferencesEditor identity={{ tenantId: ctx.tenantId, userId: ctx.userId }} available={available} labels={{ members: titleCase(resolveTerm(terminology, "member", "other")), batches: titleCase(resolveTerm(terminology, "batch", "other")) }} />
  </OwnerPage>;
}
