import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { isLiveOwnerForSettings } from "@/lib/auth/owner-settings-page-guard";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  getMemberDetailAction,
  getMemberIdCardContextAction,
  getMemberPayerAction,
  listLocationsAction,
} from "@/lib/actions/people";
import { getMemberAttendanceHistoryAction } from "@/lib/actions/attendance";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { resolveFacilityValue } from "@/lib/facility";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { listOptedFacilitiesAction } from "@/lib/actions/facility-optins";
import { MemberStatusPanel } from "@/components/member-status-panel";
import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";
import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";
import { MemberInvoicesPanel } from "@/components/member-detail/member-invoices-panel";
import { MemberFacilitiesPanel } from "@/components/member-facilities-panel";
import { MakeupCreditsPanel } from "@/components/makeup-credits-panel";
import { ParentLinkPanel } from "@/components/parent-link-panel";
import { MemberIdCard } from "@/components/member-id-card";
import { formatDateIST } from "@/lib/time/tz";
import { MEMBER_STATUS_LABELS } from "@/lib/member-status-graph";
import type { MemberStatus } from "@/db/schema/people";
import { OwnerMemberPersonalDetails } from "@/components/member-detail/owner-member-personal-details";
import { OwnerMemberBatches } from "@/components/member-detail/owner-member-batches";
import { PersonAvatar } from "@/components/avatar";
import { MemberDetailTabs, type MemberTab } from "@/components/member-detail/member-detail-tabs";
import { MemberAttendanceGrid } from "@/components/member-detail/member-attendance-grid";
import { MemberNotesPanel } from "@/components/member-detail/member-notes-panel";
import { MemberDocumentsPanel } from "@/components/member-detail/member-documents-panel";
import { MemberProgressPanel } from "@/components/member-detail/member-progress-panel";
import { getMemberProgressAction } from "@/lib/actions/assessments";
import { requireOwner } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { MembersReturnLink } from "@/components/members-return-link";
import { BackLink } from "@/components/ui/BackLink";
import { SectionHeading } from "@/components/ui/PageHeader";
import { buttonClasses } from "@/components/ui/Button";
import { requireUuidParam } from "@/lib/params";
import { getNotificationDestinationsAction } from "@/lib/actions/notification-destinations";
import { MemberNotificationDestinations } from "@/components/member-notification-destinations";
import { MemberPayerFinance } from "@/components/member-detail/member-payer-finance";
import { readOwnerMemberInitialPanels } from "@/components/member-detail/owner-member-initial-panels";
import { OwnerMemberSummary } from "@/components/member-detail/owner-member-summary";
import { MemberEditEntryLink } from "@/components/member-detail/member-edit-entry";
import { listMemberInvoicesAction } from "@/lib/actions/invoices";
import { formatINR } from "@/lib/money/format";

const TAB_KEYS = new Set<MemberTab>([
  "overview",
  "payments",
  "progress",
  "notes",
  "documents",
]);

function resolveTab(value: string | undefined): MemberTab {
  return TAB_KEYS.has(value as MemberTab) ? (value as MemberTab) : "overview";
}

// U-03/V-11 — the member 360: Overview / Payments / Progress / Notes /
// Documents. Payments reuses the C-32/C-33 invoice panel.

type ResolvedOverview = {
  attendance: Awaited<ReturnType<typeof getMemberAttendanceHistoryAction>> | null;
  card: Awaited<ReturnType<typeof getMemberIdCardContextAction>>;
  opted: Awaited<ReturnType<typeof listOptedFacilitiesAction>>;
  locations: Awaited<ReturnType<typeof listLocationsAction>>;
  panels: Awaited<ReturnType<typeof readOwnerMemberInitialPanels>>;
  destinations: Awaited<ReturnType<typeof getNotificationDestinationsAction>>;
  outstanding?: string | null;
};

export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams?: Promise<{ tab?: string; facility?: string }>;
}) {
  const ctx = await requireOwner();
  const { memberId } = await params;
  requireUuidParam(memberId);
  const sp = searchParams ? await searchParams : {};
  const tab = resolveTab(sp.tab);
  // The scope the profile was opened under: the canonical facility from
  // the URL, or an explicit "all". It travels with the member's tabs so a
  // drill-down never lands on a URL without the query — the facility
  // switcher would normalise that with a hard reload. The page's own
  // reads are unchanged: they resolve the member by id.
  const facilityScope = resolveFacilityValue(sp.facility, undefined) ?? "all";
  // The actor namespace and the edit destination. The SOURCE URL is read from
  // the browser when the Edit link actually navigates, so it is the real
  // profile URL and never an invented one.
  const editNamespace = `${ctx.tenantId}:${ctx.userId}`;
  const editHref = `/owner/members/${memberId}/edit?facility=${facilityScope}`;
  // The member's own sign-in links live on their OWN page, and the link
  // into it is shown only to a staff member who holds the grant that page
  // asks for. The page behind the link authorizes the read again.
  const canManageAccess = hasPermission(ctx, "members.link.confirm");
  const accessHref = `/owner/members/${memberId}/access?facility=${facilityScope}`;

  // C01/R02 — Accountant: skip the 360's reads, render the payer view.
  if (hasPermission(ctx, "invoices.read") && !hasPermission(ctx, "attendance.read")) {
    const [payer, timezone] = await Promise.all([
      getMemberPayerAction(memberId),
      getTenantTimezoneAction(),
    ]);
    if (!payer) notFound();
    return (
      <MemberPayerFinance
        payer={payer}
        timezone={timezone}
        canWrite={hasPermission(ctx, "invoices.write")}
        canVoid={hasPermission(ctx, "settings.manage")}
        canRecord={hasPermission(ctx, "payments.record")}
        canRefund={hasPermission(ctx, "payments.refund")}
        canReadPayments={hasPermission(ctx, "payments.read")}
      />
    );
  }

  // The entity check and the header's own data resolve BEFORE any fallback is
  // returned: a missing or foreign member can never paint a skeleton.
  const [member, terminology, timezone] = await Promise.all([
    getMemberDetailAction(memberId),
    getTerminologyAction().then(ownerTerminology),
    getTenantTimezoneAction(),
  ]);
  if (!member) notFound();

  // V-11 — only fetched when the Progress tab is actually open, and
  // only when the swim.levels module is on; the panel renders the
  // honest empty state otherwise.
  const progressEnabled = hasFeature(ctx, "swim.levels");
  const canReadProgress = hasPermission(ctx, "levels.read");
  const progress =
    tab === "progress" && progressEnabled && canReadProgress
      ? await getMemberProgressAction(member.memberId)
      : null;

  const canWrite = hasPermission(ctx, "members.write");
  const canReadPrograms = hasPermission(ctx, "programs.read");
  const canReadAttendance = hasPermission(ctx, "attendance.read");
  const canWaitlist = hasPermission(ctx, "enquiries.write");
  const canGrant = hasPermission(ctx, "programs.write");
  const canRedeem = hasPermission(ctx, "attendance.mark");
  // MF-05 — the Progress setup link lands on a settings.manage route, so a
  // reader without that grant never sees a destination they cannot use.
  const canManageSettings = hasPermission(ctx, "settings.manage") && await isLiveOwnerForSettings(ctx);

  // Resolve the overview's authorized section reads BEFORE returning this
  // page's JSX. The normal directory → profile transition must not depend on
  // async children behind nested Suspense; the route's own loading.tsx carries
  // the honest transition fallback instead. The auth, member/entity and
  // permission checks above still run first, and every other tab issues none of
  // these reads.
  let overview: ResolvedOverview | null = null;
  if (tab === "overview") {
    const [attendance, card, opted, locations, panels, destinations, outstanding] =
      await Promise.all([
        canReadAttendance ? getMemberAttendanceHistoryAction(memberId) : Promise.resolve(null),
        getMemberIdCardContextAction(),
        listOptedFacilitiesAction(memberId),
        listLocationsAction(),
        readOwnerMemberInitialPanels(memberId, { canReadPrograms, canReadAttendance }),
        canWrite ? getNotificationDestinationsAction(memberId) : Promise.resolve(null),
        hasPermission(ctx, "invoices.read")
          ? listMemberInvoicesAction(memberId).then(rows => formatINR(rows.filter(row => row.status === "issued" || row.status === "partial").reduce((sum, row) => sum + BigInt(row.outstandingPaise), 0n))).catch(() => null)
          : Promise.resolve(undefined),
      ]);
    overview = { attendance, card, opted, locations, panels, destinations, outstanding };
  }

  return (

    <OwnerPage>
      <MembersReturnLink namespace={editNamespace} facility={facilityScope}>
        <BackLink
          href="/owner/members"
          label={titleCase(resolveTerm(terminology, "member", "other"))}
        />
      </MembersReturnLink>
      <section className="rounded-[18px] border border-line bg-paper p-[18px] lg:p-5" aria-label="Member identity">
        <div className="flex items-center gap-3">
          <PersonAvatar name={member.fullName} seed={member.personId} size={58} className="shrink-0 !rounded-[20px]" />
          <div className="min-w-0">
            <h1 className="break-words font-display text-[24px] font-semibold leading-tight text-ink lg:text-[27px]">{member.fullName}</h1>
            <p className="mt-1 break-words text-[12px] text-ink-3">{member.memberCode} · {member.locationName}{member.isMinor ? " · minor" : ""}</p>
          </div>
        </div>
        <div className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-x-3 border-t border-line pt-2">
          <span className="text-[12px] text-ink-3">Joined {formatDateIST(member.joinedOn)}</span>
          {canWrite ? <MemberEditEntryLink href={editHref} namespace={editNamespace} memberId={memberId} facility={facilityScope} className={buttonClasses({ variant: "secondary", size: "sm" })}><Pencil size={14} aria-hidden="true" />Edit details</MemberEditEntryLink> : null}
        </div>
      </section>
      <MemberDetailTabs memberId={member.memberId} active={tab} facilityScope={facilityScope} accessHref={canManageAccess ? accessHref : undefined} canReadInvoices={hasPermission(ctx, "invoices.read")} canReadProgress={canReadProgress} />

      {tab === "overview" && overview ? (
        <div className="mt-4 space-y-4">
          <OverviewSections
            member={member}
            memberId={memberId}
            editHref={editHref}
            facilityScope={facilityScope}
            terminology={terminology}
            canWrite={canWrite}
            canReadPrograms={canReadPrograms}
            canWaitlist={canWaitlist}
            reads={overview}
          />

          <details className="rounded-[18px] border border-line bg-paper p-4">
            <summary className="min-h-11 cursor-pointer font-display text-[15px] font-semibold text-ink">Other {resolveTerm(terminology, "member", 1)} tools</summary>
            <MemberTools
              member={member}
              terminology={terminology}
              canWrite={canWrite}
              canGrant={canGrant}
              canRedeem={canRedeem}
              reads={overview}
            />
          </details>
        </div>
      ) : null}
      {tab === "payments" && !hasPermission(ctx, "invoices.read") ? <p role="alert" className="mt-4 text-[13px] text-ink-2">You do not have access to invoices.</p> : null}
      {tab === "payments" && hasPermission(ctx, "invoices.read") ? (
        <div className="mt-4">
          <SectionHeading
            title="Invoices"
            subtitle="Invoices and receipts for this member, with the selected invoice kept in context."
          />
          <MemberInvoicesPanel
            memberId={member.memberId}
            canWrite={hasPermission(ctx, "invoices.write")}
            canVoid={hasPermission(ctx, "settings.manage")}
            canRecord={hasPermission(ctx, "payments.record")}
            canRefund={hasPermission(ctx, "payments.refund")}
            canReadPayments={hasPermission(ctx, "payments.read")}
            timezone={timezone}
            showHeading={false}
          />
        </div>
      ) : null}

      {tab === "progress" && !canReadProgress ? <p role="alert" className="mt-4 text-[13px] text-ink-2">You do not have access to progress.</p> : null}
      {tab === "progress" && canReadProgress ? (
        <MemberProgressPanel
          progress={progress}
          emptyAction={
            progressEnabled
              && canManageSettings
              ? { label: "Set up the ladder", href: "/owner/settings/skills" }
              : undefined
          }
        />
      ) : null}
      {tab === "notes" ? (
        <MemberNotesPanel
          memberId={member.memberId}
          canWrite={hasPermission(ctx, "members.write")}
        />
      ) : null}
      {tab === "documents" ? <MemberDocumentsPanel /> : null}
    </OwnerPage>
  );
}

// The overview's three sections. The page has already resolved their
// authorized reads, so this renders from data and never suspends.
function OverviewSections({
  member,
  memberId,
  editHref,
  facilityScope,
  terminology,
  canWrite,
  canReadPrograms,
  canWaitlist,
  reads,
}: {
  member: NonNullable<Awaited<ReturnType<typeof getMemberDetailAction>>>;
  memberId: string;
  editHref: string;
  facilityScope: string;
  terminology: Awaited<ReturnType<typeof getTerminologyAction>>;
  canWrite: boolean;
  canReadPrograms: boolean;
  canWaitlist: boolean;
  reads: Pick<ResolvedOverview, "attendance" | "panels" | "destinations" | "outstanding" | "opted">;
}) {
  const attendanceHistory = reads.attendance;
  const panels = reads.panels;
  const destinations = reads.destinations;
  const activePlans = "failed" in panels.subscription ? null : panels.subscription.subscriptions.filter(plan => plan.status === "active" || plan.status === "paused");

  return (
    <>
          <OwnerMemberSummary status={member.status} plans={activePlans} balance={reads.outstanding} canManage={canWrite} paymentsHref={reads.outstanding !== undefined ? `/owner/members/${memberId}?tab=payments&facility=${facilityScope}` : undefined} />
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="space-y-4">
          {attendanceHistory ? <section>
            <MemberAttendanceGrid rows={attendanceHistory.rows} today={attendanceHistory.today} ownerCard />
          </section> : null}
          <OwnerMemberBatches enrolment={panels.enrolment} canWrite={canWrite} canReadPrograms={canReadPrograms} batchLabel={titleCase(resolveTerm(terminology, "batch", 1))} />
          </div>
          <div className="space-y-4">
          <OwnerMemberPersonalDetails member={member} canWrite={canWrite} />
          <section className="rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
            <h2 className="font-display text-[18px] font-semibold text-ink">Family and contact</h2>
            {member.isMinor ? member.guardians.length ? (
              <ul className="mt-3 divide-y divide-line">
                {member.guardians.map(g => <li key={g.personId} className="py-2 text-[13px]"><p className="font-medium text-ink">{g.fullName}{g.isPrimary ? " · primary" : ""}</p><p className="mt-1 text-[12px] text-ink-3">{g.relationship}{g.phone ? ` · ${g.phone}` : ""}</p></li>)}
              </ul>
            ) : <p className="mt-3 text-[13px] text-ink-3">No {resolveTerm(terminology, "guardian", 1)} on file.</p> : <p className="mt-3 text-[13px] text-ink-3">Contact details are listed above.</p>}
            <details className="mt-2 border-t border-line">
              <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-medium text-ink">Consent records</summary>
              {member.consents.length ? <ul className="divide-y divide-line">{member.consents.map((c, i) => <li key={i} className="py-2 text-[13px]"><span className="capitalize font-medium">{c.purpose}</span><span className="text-ink-3"> — {c.withdrawnAt ? `withdrawn ${formatDateIST(c.withdrawnAt)}` : "active"}, granted by {c.granterName || "self"}</span></li>)}</ul> : <p className="pb-2 text-[13px] text-ink-3">No consent on file.</p>}
            </details>
          </section>
          <section className="rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
            <h2 className="font-display text-[18px] font-semibold text-ink">Updates</h2>
            {member.statusHistory.length === 0 ? <p className="mt-2 text-[13px] text-ink-3">No status updates on file.</p> : null}
            {member.statusHistory.length ? <ul className="mt-2 divide-y divide-line">{member.statusHistory.map((h, i) => <li key={i} className="py-2 text-[13px]"><p className="text-ink">{MEMBER_STATUS_LABELS[h.fromStatus as MemberStatus] ?? h.fromStatus} → {MEMBER_STATUS_LABELS[h.toStatus as MemberStatus] ?? h.toStatus}</p><p className="mt-1 text-[12px] text-ink-3">{formatDateIST(h.changedAt)} · {h.reason ?? "no reason given"}</p></li>)}</ul> : null}
          </section>
          </div>

          </div>
          <details id="member-management" className="rounded-[18px] border border-line bg-paper p-4">
            <summary className="min-h-11 cursor-pointer content-center font-display text-[15px] text-ink">Manage membership</summary>
            <div id="member-management-participation" tabIndex={-1}><h2 className="sr-only">Participation management</h2><MemberStatusPanel memberId={member.memberId} status={member.status} canWrite={canWrite} /></div>
            <div id="member-management-enrolment" tabIndex={-1}><MemberEnrolmentPanel key={member.memberId} memberId={member.memberId} terminology={terminology} canEnrol={canWrite && canReadPrograms} canWaitlist={canWaitlist && canReadPrograms} canReadPrograms={canReadPrograms} facility={{ homeId: member.locationId, eligible: [{ id: member.locationId, name: member.locationName }, ...reads.opted.filter(site => site.locationId !== member.locationId).map(site => ({ id: site.locationId, name: site.locationName }))] }} initialData={panels.enrolment} /></div>
            <div id="member-management-plan" tabIndex={-1}><MemberSubscriptionPanel key={member.memberId} memberId={member.memberId} canManage={canWrite} compact initialData={panels.subscription} /></div>
            {destinations ? <MemberNotificationDestinations key={memberId} memberId={memberId} editHref={editHref} {...destinations} /> : null}
          </details>
    </>
  );
}

// The "Other tools" disclosure's panels, rendered from data the page already
// resolved above the disclosure.
function MemberTools({
  member,
  terminology,
  canWrite,
  canGrant,
  canRedeem,
  reads,
}: {
  member: NonNullable<Awaited<ReturnType<typeof getMemberDetailAction>>>;
  terminology: Awaited<ReturnType<typeof getTerminologyAction>>;
  canWrite: boolean;
  canGrant: boolean;
  canRedeem: boolean;
  reads: Pick<ResolvedOverview, "card" | "opted" | "locations" | "panels">;
}) {
  const cardCtx = reads.card;
  const optedFacilities = reads.opted;
  const locations = reads.locations;
  const panels = reads.panels;

  return (
    <>
            <MemberFacilitiesPanel
              memberId={member.memberId}
              home={{ id: member.locationId, name: member.locationName }}
              opted={optedFacilities}
              locations={locations}
              canWrite={canWrite}
            />
            {panels.makeup ? <MakeupCreditsPanel
              key={member.memberId}
              memberId={member.memberId}
              canGrant={canGrant}
              canRedeem={canRedeem}
              initialData={panels?.makeup}
            /> : null}
            <ParentLinkPanel
              memberId={member.memberId}
              memberName={member.fullName}
              terminology={terminology}
              primaryGuardianName={
                Array.isArray(member.guardians) && member.guardians.length > 0
                  ? member.guardians[0]!.fullName
                  : null
              }
            />
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
    </>
  );
}
