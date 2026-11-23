import { listEnquiriesAction, listOverdueFollowUpsAction } from "@/lib/actions/enquiries";
import { listLocationsAction } from "@/lib/actions/people";
import { EnquiriesBoard } from "@/components/enquiries-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { EnquiriesRetry } from "@/components/enquiries-retry";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function EnquiriesPage({ searchParams }: { searchParams?: Promise<{ capture?: string }> }) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "enquiries.read");
  const [enquiries, locations, overdueFollowUps, params] = await Promise.all([
    listEnquiriesAction({}).catch(() => null),
    listLocationsAction().catch(() => null),
    listOverdueFollowUpsAction().catch(() => null),
    searchParams,
  ]);

  return (
    <OwnerPage workflow="directory">
      <PageHeader
        title="Enquiries"
        purpose="Review due follow-ups or search by name or phone."
      />
      <div className="mt-5">
        {enquiries === null || locations === null ? (
          <section className="space-y-2 rounded-card border border-line bg-paper p-4">
            <p role="alert" className="text-sm">Could not load enquiries.</p>
            <EnquiriesRetry />
          </section>
        ) : (
          <>
          {overdueFollowUps === null ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p role="alert" className="text-sm text-ink-2">Could not load overdue follow-ups.</p>
              <EnquiriesRetry label="Retry follow-ups" />
            </div>
          ) : null}
          <EnquiriesBoard
          compactFilters={ctx.roleKey === "owner"}
          initialEnquiries={enquiries}
          locations={locations}
          overdueFollowUps={overdueFollowUps ?? []}
          navigationNamespace={`${ctx.tenantId}:${ctx.userId}`}
          openCapture={params?.capture === "1"}
          canWrite={hasPermission(ctx, "enquiries.write")}
          variant="oversight"
          />
          </>
        )}
      </div>
    </OwnerPage>
  );
}
