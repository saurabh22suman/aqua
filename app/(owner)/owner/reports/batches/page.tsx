import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { cookies } from "next/headers";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { FACILITY_COOKIE, parseFacilityValue } from "@/lib/facility";
import { getOwnerBatchReport } from "@/lib/services/owner-batch-report";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { BatchReport } from "@/components/reports/owner-batches/batch-report";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";

export default async function BatchesReportPage({ searchParams }: {
  searchParams?: Promise<{ facility?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.operational");
  const terminology = await getTerminologyAction().then(ownerTerminology);
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
  const reportsHref = `/owner/reports?${query}`;
  if (invalid) return <OwnerPage workflow="report"><BackLink href="/owner/reports?facility=all" label="All reports" /><PageHeader title={`${titleCase(batchMany)} report`} /><p role="alert" className="mt-4 text-[13px]">{`This ${facilityOne} selection is unavailable. Choose a ${facilityOne} and try again.`}</p><Link href="/owner/reports?facility=all" className="mt-3 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">Choose all facilities</Link></OwnerPage>;
  const result = await getOwnerBatchReport(ctx, facility).then(rows => ({ rows, error: false as const })).catch(() => ({ rows: [], error: true as const }));
  // A group row opens the existing per-batch evidence page. That page
  // enforces programs.read itself, so the link is offered only when the
  // caller holds the same grant and carries the current facility scope.
  const canOpenBatch = hasPermission(ctx, "programs.read");
  const batchHref = canOpenBatch
    ? (batchId: string) => facility ? `/owner/batches/${batchId}?facility=${facility}` : `/owner/batches/${batchId}`
    : undefined;
  return <OwnerPage workflow="report">
    <BackLink href={reportsHref} label="All reports" />
    <PageHeader title={`${titleCase(batchMany)} report`} />
    {result.error ? <section className="mt-4 rounded-card border border-line bg-paper p-4"><p role="alert" className="text-[13px]">{`${titleCase(batchOne)} places could not be loaded.`}</p><div className="mt-2 flex flex-wrap gap-3"><Link href={`/owner/reports/batches?${query}`} className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">Try again</Link><Link href={reportsHref} className="inline-flex min-h-11 items-center text-[13px] text-ink-2 underline underline-offset-2">All reports</Link></div></section> :
      <BatchReport rows={result.rows} batchOne={batchOne} batchMany={batchMany} batchHref={batchHref} canViewFinancial={hasPermission(ctx, "reports.financial") && hasPermission(ctx, "invoices.read") && hasFeature(ctx, "reports") && hasFeature(ctx, "billing")} collectionsHref={`/owner/reports/collections?${query}`} />}
  </OwnerPage>;
}
