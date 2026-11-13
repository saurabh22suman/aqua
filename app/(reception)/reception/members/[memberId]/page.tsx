import { notFound } from "next/navigation";
import { getMemberDetailAction, getMemberIdCardContextAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";
import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";
import { MemberInvoicesPanel } from "@/components/member-detail/member-invoices-panel";
import { MemberIdCard } from "@/components/member-id-card";
import { resolveTerm } from "@/lib/terminology/keys";
import { requireReception } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { formatDateIST } from "@/lib/time/tz";
import { requireUuidParam } from "@/lib/params";
import { formatPhoneIN } from "@/lib/phone";
import { getNotificationDestinationsAction } from "@/lib/actions/notification-destinations";
import { MemberNotificationDestinations } from "@/components/member-notification-destinations";
import { BackLink } from "@/components/ui/BackLink";
import { PersonAvatar } from "@/components/avatar";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import {
  STAFF_CARD,
  StaffPage,
  StaffSection,
} from "@/components/staff-ui/staff-page";

// B3 — reception previously had no member detail page at all: a
// receptionist who created a member (or one produced by converting an
// enquiry) had no way to see them again, let alone enrol them in a
// batch. Reuses getMemberDetailAction (assertStaff already includes
// receptionist) rather than duplicating the query; scoped to what
// reception needs right after registration — identity, guardians,
// consent, enrolment — not lifecycle controls or attendance history,
// which live on the owner-side detail page.
export default async function ReceptionMemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const ctx = await requireReception();
  const { memberId } = await params;
  requireUuidParam(memberId);
  const [member, cardCtx, terminology, timezone] = await Promise.all([
    getMemberDetailAction(memberId),
    getMemberIdCardContextAction(),
    // The id-card's eyebrow renders the closed-key `member` singular
    // form via resolveTerm (L3 audit). Reception registers the member
    // and prints the card in the same visit; the same terminology
    // fetch that the owner-side page uses pays the cost here too.
    getTerminologyAction(),
    getTenantTimezoneAction(),
  ]);
  if (!member) notFound();
  const destinations = hasPermission(ctx, "members.write")
    ? await getNotificationDestinationsAction(memberId) : null;

  return (
    <StaffPage>
      <BackLink href="/reception/members" label="Search" />

      <div
        className="mt-2 flex items-start gap-3"
        data-testid="reception-member-identity"
      >
        <PersonAvatar name={member.fullName} seed={member.memberId} size={48} className="flex-none" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-medium leading-tight tracking-[-0.01em] text-ink">
            {member.fullName}
          </h1>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
            {member.memberCode} · {member.locationName}
            {member.isMinor ? " · minor" : ""}
          </p>
        </div>
      </div>

      {cardCtx && terminology ? (
        <div className="print-isolate-block mt-4">
          <MemberIdCard
            tenantSlug={cardCtx.tenantSlug}
            tenantDisplayName={cardCtx.displayName}
            tenantAccent={cardCtx.accent}
            initials={cardCtx.initials}
            memberFullName={member.fullName}
            memberCode={member.memberCode}
            memberUuid={member.memberId}
            terminology={terminology}
          />
        </div>
      ) : null}

      {destinations ? (
        <MemberNotificationDestinations key={memberId} memberId={memberId} {...destinations} />
      ) : null}
      <MemberEnrolmentPanel
        memberId={member.memberId}
        terminology={terminology}
        canEnrol={hasPermission(ctx, "members.write")}
        canWaitlist={hasPermission(ctx, "enquiries.write")}
      />

      <MemberSubscriptionPanel
        memberId={member.memberId}
        canManage={hasPermission(ctx, "members.write")}
      />

      <MemberInvoicesPanel
        memberId={member.memberId}
        canWrite={hasPermission(ctx, "invoices.write")}
        canVoid={hasPermission(ctx, "settings.manage")}
        canRecord={hasPermission(ctx, "payments.record")}
        canRefund={hasPermission(ctx, "payments.refund")}
        canReadPayments={hasPermission(ctx, "payments.read")}
        timezone={timezone}
      />

      {member.isMinor ? (
        <StaffSection
          title={
            <span className="flex items-center gap-2">
              <OwnerIcon name="members" size={16} className="text-ink-3" />
              Guardians
            </span>
          }
        >
          {member.guardians.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">
              No {resolveTerm(terminology, "guardian", 1)} on file.
            </p>
          ) : (
            <ul className={`mt-2 divide-y divide-line ${STAFF_CARD}`}>
              {member.guardians.map((g) => (
                <li key={g.personId} className="px-3.5 py-2.5 text-[13px]">
                  <span className="font-medium text-ink">{g.fullName}</span>
                  <span className="text-ink-3"> — {g.relationship}</span>
                  {g.phone ? <span className="text-ink-3"> · {formatPhoneIN(g.phone)}</span> : null}
                  {g.isPrimary ? (
                    <span className="ml-1.5 text-[12px] text-ink-2">primary</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </StaffSection>
      ) : null}

      <StaffSection
        title={
          <span className="flex items-center gap-2">
            <OwnerIcon name="lock" size={16} className="text-ink-3" />
            Consent
          </span>
        }
      >
        {member.consents.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-3">No consent on file.</p>
        ) : (
          <ul className={`mt-2 divide-y divide-line ${STAFF_CARD}`}>
            {member.consents.map((c, i) => (
              <li key={i} className="px-3.5 py-2.5 text-[13px]">
                <span className="font-medium capitalize text-ink">{c.purpose}</span>
                <span className="text-ink-3">
                  {" "}
                  — {c.withdrawnAt ? `withdrawn ${formatDateIST(c.withdrawnAt)}` : "active"},
                  granted by {c.granterName || "self"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </StaffSection>
    </StaffPage>
  );
}
