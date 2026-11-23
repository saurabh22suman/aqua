import { requireReception } from "@/lib/auth/surface-guard";
import { DESK_DUES_LIMIT } from "@/lib/services/fees-hub";
import { listDeskDuesAction } from "@/lib/actions/fees-hub";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";
import { STAFF_CARD, StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";
import { ReceptionDuesList } from "@/components/reception/dues-list";

export default async function ReceptionDuesPage() {
  const ctx = await requireReception();
  const canCollect = hasPermission(ctx, "payments.record") && hasFeature(ctx, "billing");
  const dues = await listDeskDuesAction().catch(() => null);

  return (
    <StaffPage className="max-w-xl">
      <BackLink href="/reception" label="Today" />
      <StaffPageHeader title="Dues" meta="Find the invoice before calling a family or collecting a payment." />
      {dues === null ? (
        <section className={`mt-5 space-y-3 p-4 ${STAFF_CARD}`}>
          <p role="alert" className="text-sm">Could not load dues. Try again to see the current invoices.</p>
          <a href="/reception/dues" className={buttonClasses({ variant: "secondary", size: "sm" })}>Retry dues</a>
        </section>
      ) : (
        <ReceptionDuesList dues={dues} canCollect={canCollect} limit={DESK_DUES_LIMIT} />
      )}
    </StaffPage>
  );
}
