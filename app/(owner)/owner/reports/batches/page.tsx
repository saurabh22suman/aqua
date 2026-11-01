import { cookies } from "next/headers";
import Link from "next/link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { FACILITY_COOKIE, parseFacilityValue } from "@/lib/facility";
import { getOwnerBatchReport } from "@/lib/services/owner-batch-report";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BatchReport } from "@/components/reports/owner-batches/batch-report";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";

export default async function BatchesReportPage({ searchParams }: {
  searchParams?: Promise<{ facility?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.operational");
  const terminology = await getTerminologyAction();
  const batchOne = resolveTerm(terminology, "batch", 1);
  const batchMany = resolveTerm(terminology, "batch", "other");
  const facilityOne = resolveTerm(terminology, "facility", 1);
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const invalid = params.facility !== undefined && params.facility !== "all" && !parseFacilityValue(params.facility);
  const facility = params.facility === "all" ? undefined : params.facility !== undefined
    ? parseFacilityValue(params.facility)
    : parseFacilityValue(cookieStore.get(FACILITY_COOKIE)?.value);
  const scope = facility ?? "all";
  const query = new URLSearchParams({ facility: scope }).toString();
  if (invalid) return <OwnerPage><PageHeader title={`${titleCase(batchMany)} report`} /><p role="alert" className="mt-4 text-[13px]">{`This ${facilityOne} selection is unavailable. Choose a ${facilityOne} and try again.`}</p></OwnerPage>;
  const result = await getOwnerBatchReport(ctx, facility).then(rows => ({ rows, error: false as const })).catch(() => ({ rows: [], error: true as const }));
  return <OwnerPage>
    <Link href={`/owner/reports?${query}`} className="inline-flex min-h-11 items-center text-[13px] font-medium text-ink-2">← All reports</Link>
    <PageHeader title={`${titleCase(batchMany)} report`} />
    {result.error ? <p role="alert" className="mt-4 rounded-card border border-line bg-paper p-4 text-[13px]">{`${titleCase(batchOne)} places could not be loaded. Try again.`}</p> :
      <BatchReport rows={result.rows} batchOne={batchOne} batchMany={batchMany} canViewFinancial={hasPermission(ctx, "reports.financial") && hasPermission(ctx, "invoices.read") && hasFeature(ctx, "reports") && hasFeature(ctx, "billing")} collectionsHref={`/owner/reports/collections?${query}`} />}
  </OwnerPage>;
}
