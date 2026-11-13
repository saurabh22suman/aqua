import { isLiveOwnerForSettings } from "@/lib/auth/owner-settings-page-guard";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import ClipboardCheck from "lucide-react/dist/esm/icons/clipboard-check.mjs";
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
import { MEMBER_STATUS_LABELS } from "@/lib/member-status-graph";
import { formatDateIST } from "@/lib/time/tz";
import { InlineEditField } from "@/components/member-detail/inline-edit-field";
import { MemberDetailTabs, type MemberTab } from "@/components/member-detail/member-detail-tabs";
import { MemberProfileSections } from "@/components/member-detail/member-profile-sections";
import { MemberAttendanceGrid } from "@/components/member-detail/member-attendance-grid";
import { MemberNotesPanel } from "@/components/member-detail/member-notes-panel";
import { MemberDocumentsPanel } from "@/components/member-detail/member-documents-panel";
import { MemberProgressPanel } from "@/components/member-detail/member-progress-panel";
import { getMemberProgressAction } from "@/lib/actions/assessments";
import { requireOwner } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerLink } from "@/components/owner-ui/owner-link";
import { MembersReturnLink } from "@/components/members-return-link";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";
import { buttonClasses } from "@/components/ui/Button";
import { StatusBadge, MEMBER_STATUS_TONE } from "@/components/ui/StatusBadge";
import { requireUuidParam } from "@/lib/params";
import { getNotificationDestinationsAction } from "@/lib/actions/notification-destinations";
import { MemberNotificationDestinations } from "@/components/member-notification-destinations";
import { MemberPayerFinance } from "@/components/member-detail/member-payer-finance";
import { readOwnerMemberInitialPanels } from "@/components/member-detail/owner-member-initial-panels";
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
  attendance: Awaited<ReturnType<typeof getMemberAttendanceHistoryAction>>;
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
  const accessHref = `/owner/members/${memberId}/access`;

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
    getTerminologyAction(),
    getTenantTimezoneAction(),
  ]);
  if (!member) notFound();

  // V-11 — only fetched when the Progress tab is actually open, and
  // only when the swim.levels module is on; the panel renders the
  // honest empty state otherwise.
  const progressEnabled = hasFeature(ctx, "swim.levels");
  const progress =
    tab === "progress" && progressEnabled
      ? await getMemberProgressAction(member.memberId)
      : null;

  const canWrite = hasPermission(ctx, "members.write");
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
        getMemberAttendanceHistoryAction(memberId),
        getMemberIdCardContextAction(),
        listOptedFacilitiesAction(memberId),
        listLocationsAction(),
        readOwnerMemberInitialPanels(memberId),
        canWrite ? getNotificationDestinationsAction(memberId) : Promise.resolve(null),
        hasPermission(ctx, "invoices.read")
          ? listMemberInvoicesAction(memberId).then(rows => formatINR(rows.filter(row => row.status === "issued" || row.status === "partial").reduce((sum, row) => sum + BigInt(row.outstandingPaise), 0n))).catch(() => null)
          : Promise.resolve(undefined),
      ]);
    overview = { attendance, card, opted, locations, panels, destinations, outstanding };
  }

  return (

    <OwnerPage>
      <MembersReturnLink>
        <BackLink
          href="/owner/members"
          label={titleCase(resolveTerm(terminology, "member", "other"))}
        />
      </MembersReturnLink>
      <div className="rounded-card border border-line bg-paper p-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <InlineEditField
              value={member.fullName}
              field="fullName"
              memberId={member.memberId}
              type="text"
              snapshot={member}
              readOnly={!canWrite}
              valueClassName="font-display text-[22px] font-semibold text-ink"
            />
            <StatusBadge tone={MEMBER_STATUS_TONE[member.status] ?? "neutral"}>
              {MEMBER_STATUS_LABELS[member.status]}
            </StatusBadge>
          </span>
        }
        purpose={`${member.memberCode} · ${member.locationName}${
          member.isMinor ? " · minor" : ""
        } · joined ${formatDateIST(member.joinedOn)}`}
        action={
          canManageAccess || canWrite ? (
            <>
              {canManageAccess ? (
                <OwnerLink
                  href={accessHref}
                  className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-ink-2 underline underline-offset-2"
                  data-testid="member-access-entry"
                >
                  <ClipboardCheck size={14} aria-hidden="true" />
                  Member and family access
                </OwnerLink>
              ) : null}
              {canWrite ? (
                <MemberEditEntryLink
                  href={editHref}
                  namespace={editNamespace}
                  memberId={memberId}
                  facility={facilityScope}
                  className={buttonClasses({ variant: "secondary", size: "md" })}
                >
                  <Pencil size={14} aria-hidden="true" />
                  Edit details
                </MemberEditEntryLink>
              ) : null}
            </>
          ) : undefined
        }
      />

      <MemberDetailTabs
        memberId={member.memberId}
        active={tab}
        facilityScope={facilityScope}
      />
      </div>

      {tab === "overview" && overview ? (
        <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-6 lg:grid-cols-2 lg:items-start">
          <OverviewSections
            member={member}
            memberId={memberId}
            terminology={terminology}
            canWrite={canWrite}
            canWaitlist={canWaitlist}
            reads={overview}
          />

          <details className="rounded-card border border-line bg-paper p-4">
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
      {tab === "payments" ? (
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

      {tab === "progress" ? (
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
  terminology,
  canWrite,
  canWaitlist,
  reads,
}: {
  member: NonNullable<Awaited<ReturnType<typeof getMemberDetailAction>>>;
  memberId: string;
  terminology: Awaited<ReturnType<typeof getTerminologyAction>>;
  canWrite: boolean;
  canWaitlist: boolean;
  reads: Pick<ResolvedOverview, "attendance" | "panels" | "destinations" | "outstanding">;
}) {
  const attendanceHistory = reads.attendance;
  const panels = reads.panels;
  const destinations = reads.destinations;

  return (
    <>
          <section>
            <SectionHeading title="Participation & enrolment" />
            <div className="mt-3 rounded-card border border-line bg-paper p-3.5">
              <MemberStatusPanel
                memberId={member.memberId}
                status={member.status}
                canWrite={canWrite}
                summary={{plans: !panels || "failed" in panels.subscription ? null : panels.subscription.subscriptions.filter(plan => plan.status === "active" || plan.status === "paused").map(plan => ({name:plan.planName,status:plan.status})), balance:reads.outstanding}}
              />
            </div>
            <MemberEnrolmentPanel
              key={member.memberId}
              memberId={member.memberId}
              terminology={terminology}
              canEnrol={canWrite}
              canWaitlist={canWaitlist}
              initialData={panels?.enrolment}
            />
            <MemberSubscriptionPanel
              key={member.memberId}
              memberId={member.memberId}
              canManage={canWrite}
              initialData={panels?.subscription}
            />
          </section>

          <section>
            <SectionHeading title="Contacts & consent" />
            {destinations ? (
              <MemberNotificationDestinations
                key={memberId}
                memberId={memberId}
                {...destinations}
              />
            ) : null}
            <MemberProfileSections
              member={member}
              attendanceHistory={attendanceHistory}
              terminology={terminology}
              sections={["guardians", "consent"]}
            />

            <SectionHeading className="mt-5" title="Personal details" />
            <dl className="mt-2 space-y-2 rounded-card border border-line bg-paper p-3.5 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Phone</dt>
                <dd>
                  <InlineEditField
                    value={member.phone ?? ""}
                    field="phone"
                    memberId={member.memberId}
                    type="text"
                    snapshot={member}
                    placeholder="Add phone"
                    formatAs="phone"
                    readOnly={!canWrite}
                  />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Date of birth</dt>
                <dd>
                  <InlineEditField
                    value={member.dateOfBirth ?? ""}
                    field="dateOfBirth"
                    memberId={member.memberId}
                    type="text"
                    snapshot={member}
                    readOnly={!canWrite}
                  />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Gender</dt>
                <dd>
                  <InlineEditField
                    value={member.gender ?? ""}
                    field="gender"
                    memberId={member.memberId}
                    type="select"
                    snapshot={member}
                    options={[
                      { value: "male", label: "Male" },
                      { value: "female", label: "Female" },
                      { value: "other", label: "Other" },
                    ]}
                    readOnly={!canWrite}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Medical notes</dt>
                <dd className="mt-0.5">
                  <InlineEditField
                    value={member.medicalNotes ?? ""}
                    field="medicalNotes"
                    memberId={member.memberId}
                    type="textarea"
                    snapshot={member}
                    placeholder="Add medical notes"
                    readOnly={!canWrite}
                  />
                </dd>
              </div>
            </dl>

            <MemberProfileSections
              member={member}
              attendanceHistory={attendanceHistory}
              terminology={terminology}
              sections={["status"]}
            />
          </section>

          <section>
            <SectionHeading
              title="Attendance evidence"
              subtitle="Recent marked sessions."
            />
            <MemberAttendanceGrid
              rows={attendanceHistory.rows}
              today={attendanceHistory.today}
            />
          </section>
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
            <MakeupCreditsPanel
              key={member.memberId}
              memberId={member.memberId}
              canGrant={canGrant}
              canRedeem={canRedeem}
              initialData={panels?.makeup}
            />
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
