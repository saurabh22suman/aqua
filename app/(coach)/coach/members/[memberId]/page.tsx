import { notFound } from "next/navigation";
import Link from "next/link";
import { getCoachMemberDetailAction } from "@/lib/actions/coach";
import { getMemberProgressAction } from "@/lib/actions/assessments";
import { listMemberAlertsAction } from "@/lib/actions/absence-alerts";
import { AbsenceAlertsList } from "@/components/absence-alerts-list";
import { MemberAttendanceGrid } from "@/components/member-detail/member-attendance-grid";
import { MemberProgressPanel } from "@/components/member-detail/member-progress-panel";
import { requireCoach } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { formatPhoneIN } from "@/lib/phone";
import { BackLink } from "@/components/ui/BackLink";
import { PersonAvatar } from "@/components/avatar";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { buttonClasses } from "@/components/ui/Button";
import { requireUuidParam } from "@/lib/params";
import {
  STAFF_CARD,
  StaffPage,
  StaffSection,
} from "@/components/staff-ui/staff-page";

// Coach member detail — the coach-scoped subset of the member's
// record. The page is intentionally narrow: name, code, batches
// coached, phone, medical notes, attendance (90d). For minors,
// guardian name + phone only — what a coach needs to call when
// something goes wrong, not the full owner view (status, edits,
// consent detail, parent-link issuance). Coach can't edit and
// shouldn't see the DPDP detail.
export default async function CoachMemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const ctx = await requireCoach();
  const { memberId } = await params;
  requireUuidParam(memberId);
  // V-11 — progress is a staff-side view gated on the swim.levels
  // module; a tenant without it just doesn't render the section.
  const ladderEnabled =
    hasFeature(ctx, "swim.levels") && hasPermission(ctx, "levels.read");
  const [m, alerts, progress] = await Promise.all([
    getCoachMemberDetailAction(memberId),
    // R.8 — read-only attendance alerts for this member.
    listMemberAlertsAction(memberId),
    ladderEnabled
      ? getMemberProgressAction(memberId)
      : Promise.resolve(null),
  ]);
  if (!m) notFound();
  const canAssess = ladderEnabled && hasPermission(ctx, "levels.assess");
  const hasLadder =
    ladderEnabled && (progress?.frameworks.some((f) => f.nodes.length > 0) ?? false);

  return (
    <StaffPage>
      <BackLink href="/coach/members" label="Members" />

      <div className="flex items-start gap-3" data-testid="coach-member-identity">
        <PersonAvatar name={m.fullName} seed={m.memberId} size={48} className="flex-none" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-medium leading-tight tracking-[-0.01em] text-ink">
            {m.fullName}
          </h1>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
            {m.memberCode}
            {m.isMinor ? " · minor" : ""}
            {m.batches.length > 0 ? ` · ${m.batches.join(", ")}` : ""}
          </p>
        </div>
      </div>

      <section className={`mt-4 space-y-3 p-4 ${STAFF_CARD}`}>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
            Phone
          </p>
          <p className="mt-0.5 text-[14px] text-ink">
            {m.phone ? (
              formatPhoneIN(m.phone)
            ) : (
              <span className="text-ink-3">No phone on file</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
            Medical notes
          </p>
          <p className="mt-0.5 text-[13.5px] leading-snug text-ink">
            {m.medicalNotes ?? <span className="text-ink-3">None on file.</span>}
          </p>
        </div>
      </section>

      <AbsenceAlertsList alerts={alerts} />

      {m.isMinor && m.guardians.length > 0 ? (
        <StaffSection
          title={
            <span className="flex items-center gap-1.5">
              <OwnerIcon name="members" size={16} className="text-ink-3" />
              Guardians
            </span>
          }
          meta="Who to call"
        >
          <ul className={`mt-2 divide-y divide-line ${STAFF_CARD}`}>
            {m.guardians.map((g, i) => (
              <li key={i} className="px-3.5 py-2.5 text-[13px]">
                <p className="font-medium text-ink">{g.fullName}</p>
                <p className="mt-0.5 text-ink-2">
                  {g.phone ? (
                    formatPhoneIN(g.phone)
                  ) : (
                    <span className="text-ink-3">No phone on file</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </StaffSection>
      ) : null}

      <StaffSection
        title={
          <span className="flex items-center gap-1.5">
            <OwnerIcon name="calendar" size={16} className="text-ink-3" />
            Attendance
          </span>
        }
      >
        <MemberAttendanceGrid
          rows={m.attendance.rows}
          today={m.attendance.today}
          scopeNote="Counts only sessions from batches you coach."
          registerBasePath="/coach/register"
        />
      </StaffSection>

      {ladderEnabled ? (
        <StaffSection
          title={
            <span className="flex items-center gap-1.5">
              <OwnerIcon name="reports" size={16} className="text-ink-3" />
              Progress
            </span>
          }
          action={
            canAssess && hasLadder ? (
              <Link
                href={`/coach/members/${m.memberId}/assess`}
                className={buttonClasses({ variant: "primary", size: "sm" })}
              >
                Record assessment
              </Link>
            ) : null
          }
        >
          <MemberProgressPanel progress={progress} />
        </StaffSection>
      ) : null}
    </StaffPage>
  );
}
