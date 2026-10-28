import Link from "next/link";
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
import { MemberNotesPanel } from "@/components/member-detail/member-notes-panel";
import { MemberDocumentsPanel } from "@/components/member-detail/member-documents-panel";
import { MemberProgressPanel } from "@/components/member-detail/member-progress-panel";
import { getMemberProgressAction } from "@/lib/actions/assessments";
import { requireOwner } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";
import { StatusBadge, MEMBER_STATUS_TONE } from "@/components/ui/StatusBadge";
import { requireUuidParam } from "@/lib/params";
import { getNotificationDestinationsAction } from "@/lib/actions/notification-destinations";
import { MemberNotificationDestinations } from "@/components/member-notification-destinations";
import { MemberPayerFinance } from "@/components/member-detail/member-payer-finance";

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

export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const ctx = await requireOwner();
  const { memberId } = await params;
  requireUuidParam(memberId);
  const sp = searchParams ? await searchParams : {};
  const tab = resolveTab(sp.tab);

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

  const [
    member,
    attendanceHistory,
    cardCtx,
    terminology,
    optedFacilities,
    locations,
    timezone,
  ] = await Promise.all([
    getMemberDetailAction(memberId),
    getMemberAttendanceHistoryAction(memberId),
    getMemberIdCardContextAction(),
    getTerminologyAction(),
    listOptedFacilitiesAction(memberId),
    listLocationsAction(),
    getTenantTimezoneAction(),
  ]);
  if (!member) notFound();
  const destinations = tab === "overview" && hasPermission(ctx, "members.write")
    ? await getNotificationDestinationsAction(memberId) : null;

  // V-11 — only fetched when the Progress tab is actually open, and
  // only when the swim.levels module is on; the panel renders the
  // honest empty state otherwise.
  const progressEnabled = hasFeature(ctx, "swim.levels");
  const progress =
    tab === "progress" && progressEnabled
      ? await getMemberProgressAction(member.memberId)
      : null;

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/members" label="Members" />
      {cardCtx && terminology ? (
        <div className="print-isolate-block">
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

      <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Owner redesign (C2) — the identity line carries the
              lifecycle state, the same way the member directory row
              does, so the state is readable without scrolling to the
              participation card. */}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[19px] font-semibold">
              <InlineEditField
                value={member.fullName}
                field="fullName"
                memberId={member.memberId}
                type="text"
                snapshot={member}
                valueClassName="font-display text-[19px] font-semibold text-ink"
              />
            </h1>
            <StatusBadge tone={MEMBER_STATUS_TONE[member.status] ?? "neutral"}>
              {MEMBER_STATUS_LABELS[member.status]}
            </StatusBadge>
          </div>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {member.memberCode} · {member.locationName}
            {member.isMinor ? " · minor" : ""}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            Joined {formatDateIST(member.joinedOn)}
          </p>
        </div>
        <Link
          href={`/owner/members/${member.memberId}/edit`}
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          <Pencil size={14} aria-hidden="true" />
          Edit details
        </Link>
      </div>

      <MemberDetailTabs memberId={member.memberId} active={tab} />

      {tab === "overview" ? (
        <>
          {destinations ? <MemberNotificationDestinations key={memberId} memberId={memberId} {...destinations} /> : null}
          <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
            <p className="text-[12px] text-ink-3">Academy participation</p>
            <p className="mt-0.5 font-display text-[16px] font-semibold">
              {MEMBER_STATUS_LABELS[member.status]}
            </p>
            <MemberStatusPanel
              memberId={member.memberId}
              status={member.status}
              canWrite={hasPermission(ctx, "members.write")}
            />
          </div>

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
          <MemberFacilitiesPanel
            memberId={member.memberId}
            home={{ id: member.locationId, name: member.locationName }}
            opted={optedFacilities}
            locations={locations}
            canWrite={hasPermission(ctx, "members.write")}
          />
          <MakeupCreditsPanel
            memberId={member.memberId}
            canGrant={hasPermission(ctx, "programs.write")}
            canRedeem={hasPermission(ctx, "attendance.mark")}
          />
          <ParentLinkPanel
            memberId={member.memberId}
            memberName={member.fullName}
            primaryGuardianName={
              Array.isArray(member.guardians) && member.guardians.length > 0
                ? member.guardians[0]!.fullName
                : null
            }
          />

          <dl className="mt-4 space-y-2 rounded-card border border-line bg-paper p-3.5 text-[13px]">
            <div className="flex justify-between">
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
                />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-3">Date of birth</dt>
              <dd>
                <InlineEditField
                  value={member.dateOfBirth ?? ""}
                  field="dateOfBirth"
                  memberId={member.memberId}
                  type="date"
                  snapshot={member}
                />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-3">Gender</dt>
              <dd>
                <InlineEditField
                  value={member.gender ?? ""}
                  field="gender"
                  memberId={member.memberId}
                  type="select"
                  options={[
                    { value: "male", label: "Male" },
                    { value: "female", label: "Female" },
                    { value: "other", label: "Other" },
                  ]}
                  snapshot={member}
                  valueClassName="capitalize"
                  placeholder="Not recorded"
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
                />
              </dd>
            </div>
          </dl>

          <MemberProfileSections
            member={member}
            attendanceHistory={attendanceHistory}
            terminology={terminology}
          />
        </>
      ) : null}

      {tab === "payments" ? (
        <MemberInvoicesPanel
          memberId={member.memberId}
          canWrite={hasPermission(ctx, "invoices.write")}
          canVoid={hasPermission(ctx, "settings.manage")}
          canRecord={hasPermission(ctx, "payments.record")}
          canRefund={hasPermission(ctx, "payments.refund")}
          canReadPayments={hasPermission(ctx, "payments.read")}
          timezone={timezone}
        />
      ) : null}

      {tab === "progress" ? (
        <MemberProgressPanel
          progress={progress}
          emptyAction={
            progressEnabled
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
    </main>
  );
}
