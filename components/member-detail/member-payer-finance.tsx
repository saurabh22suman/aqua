import { BackLink } from "@/components/ui/BackLink";
import { MemberInvoicesPanel } from "@/components/member-detail/member-invoices-panel";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { MEMBER_STATUS_LABELS } from "@/lib/member-status-graph";
import { formatPhoneIN } from "@/lib/phone";
import type { MemberPayerView } from "@/lib/services/people";

// C01/R02 (docs/audits/2026-10-09-role-content-permission-audit.md §9,
// §10) — the Accountant's finance-only member view: payer header plus the
// invoice panel, and none of the member-360's Overview/Progress/Notes/
// Documents tabs, edit, lifecycle, makeup or parent-link affordances.
// The page renders this when the caller holds invoices.read without
// attendance.read, feeding it only the payer projection.
export function MemberPayerFinance({
  payer,
  canWrite,
  canVoid,
  canRecord,
  canRefund,
  canReadPayments,
  timezone,
}: {
  payer: MemberPayerView;
  canWrite: boolean;
  canVoid: boolean;
  canRecord: boolean;
  canRefund: boolean;
  canReadPayments: boolean;
  timezone: string;
}) {
  return (
    <OwnerPage>
      <BackLink href="/owner/members" label="Members" />
      <PageHeader
        className="mt-2"
        title={payer.fullName}
        purpose={`${payer.memberCode} · ${payer.locationName}${
          payer.isMinor ? " · minor" : ""
        }`}
      />
      <dl className="mt-4 space-y-2 rounded-card border border-line bg-paper p-3.5 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-ink-3">Phone</dt>
          <dd>{payer.phone ? formatPhoneIN(payer.phone) : "Not recorded"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-3">Status</dt>
          <dd>{MEMBER_STATUS_LABELS[payer.status]}</dd>
        </div>
      </dl>
      <MemberInvoicesPanel
        memberId={payer.memberId}
        canWrite={canWrite}
        canVoid={canVoid}
        canRecord={canRecord}
        canRefund={canRefund}
        canReadPayments={canReadPayments}
        timezone={timezone}
      />
    </OwnerPage>
  );
}
