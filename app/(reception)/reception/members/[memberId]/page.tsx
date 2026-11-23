import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemberDetailAction, getMemberIdCardContextAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";
import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";
import { MemberInvoicesPanel } from "@/components/member-detail/member-invoices-panel";
import { MemberIdCard } from "@/components/member-id-card";
import { resolveTerm } from "@/lib/terminology/keys";
import { staffTerminology } from "@/lib/terminology/staff-terms";
import { requireReception } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { formatDateIST } from "@/lib/time/tz";
import { requireUuidParam } from "@/lib/params";
import { formatPhoneIN } from "@/lib/phone";
import { getNotificationDestinationsAction } from "@/lib/actions/notification-destinations";
import { MemberNotificationDestinations } from "@/components/member-notification-destinations";
import { BackToReceptionSearch } from "@/components/reception/member-search-navigation";
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
//
// Batch 4 — identity first, then the desk tasks in the order reception
// actually performs them: see the invoice/receipt, enrol in a batch,
// start or change a plan. Printable identity, notifications, guardians
// and consent follow as member records. The anchors are same-page DOM
// targets; no new route, capability or commercial workflow is added.
const TASK_SECTION =
  "scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus-ring)]";

export default async function ReceptionMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams?: Promise<{ searchReturn?: string }>;
}) {
  const ctx = await requireReception();
  const { memberId } = await params;
  const query = await searchParams;
  requireUuidParam(memberId);
  const [member, cardCtx, terminology, timezone] = await Promise.all([
    getMemberDetailAction(memberId),
    getMemberIdCardContextAction(),
    // The id-card's eyebrow renders the closed-key `member` singular
    // form via resolveTerm (L3 audit). Reception registers the member
    // and prints the card in the same visit; the same terminology
    // fetch that the owner-side page uses pays the cost here too.
    getTerminologyAction().then(staffTerminology),
    getTenantTimezoneAction(),
  ]);
  if (!member) notFound();
  const destinations = hasPermission(ctx, "members.write")
    ? await getNotificationDestinationsAction(memberId) : null;

  return (
    <StaffPage>
      <BackToReceptionSearch memberId={memberId} namespace={`${ctx.tenantId}:${ctx.userId}`} token={query?.searchReturn} />

      <div
        className="mt-2 flex items-start gap-3"
        data-testid="reception-member-identity"
      >
        <PersonAvatar name={member.fullName} seed={member.memberId} size={48} className="flex-none" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink">
            {member.fullName}
          </h1>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
            {member.memberCode} · {member.locationName}
            {member.isMinor ? " · minor" : ""}
          </p>
        </div>
      </div>

      <nav aria-label="Member tasks" className="mt-4">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 [&_a]:w-full [&_a]:justify-center">
          <li>
            <Link replace prefetch={false} href="#member-invoices" aria-label="Invoices and payments" className="inline-flex min-h-11 items-center rounded-pill border border-line bg-paper px-3.5 text-[13px] font-medium text-water">
              Invoices
            </Link>
          </li>
          <li>
            <Link replace prefetch={false} href="#member-enrolment" aria-label="Batch enrolment" className="inline-flex min-h-11 items-center rounded-pill border border-line bg-paper px-3.5 text-[13px] font-medium text-water">
              Enrolment
            </Link>
          </li>
          <li>
            <Link replace prefetch={false} href="#member-plans" aria-label="Membership plans" className="inline-flex min-h-11 items-center rounded-pill border border-line bg-paper px-3.5 text-[13px] font-medium text-water">
              Plans
            </Link>
          </li>
          <li>
            <Link replace prefetch={false} href="#member-records" aria-label="Member records" className="inline-flex min-h-11 items-center rounded-pill border border-line bg-paper px-3.5 text-[13px] font-medium text-ink-2">
              Records
            </Link>
          </li>
        </ul>
      </nav>

      <section id="member-invoices" aria-labelledby="member-invoices-title" tabIndex={-1} className={`mt-5 ${TASK_SECTION}`}>
        <h2 id="member-invoices-title" className="text-[15px] font-medium leading-tight text-ink">
          Invoices and payments
        </h2>
        <MemberInvoicesPanel
          showHeading={false}
          memberId={member.memberId}
          canWrite={hasPermission(ctx, "invoices.write")}
          canVoid={hasPermission(ctx, "settings.manage")}
          canRecord={hasPermission(ctx, "payments.record")}
          canRefund={hasPermission(ctx, "payments.refund")}
          canReadPayments={hasPermission(ctx, "payments.read")}
          timezone={timezone}
        />
      </section>

      <section id="member-enrolment" tabIndex={-1} className={TASK_SECTION}>
        <MemberEnrolmentPanel
          memberId={member.memberId}
          terminology={terminology}
          canEnrol={hasPermission(ctx, "members.write")}
          canWaitlist={hasPermission(ctx, "enquiries.write")}
        />
      </section>

      <section id="member-plans" tabIndex={-1} className={TASK_SECTION}>
        <MemberSubscriptionPanel
          memberId={member.memberId}
          canManage={hasPermission(ctx, "members.write")}
        />
      </section>

      <section id="member-records" tabIndex={-1} className={TASK_SECTION}>
        <StaffSection title="Member records">
          {cardCtx && terminology ? (
            <div className="print-isolate-block mt-3">
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
        </StaffSection>
      </section>
    </StaffPage>
  );
}
