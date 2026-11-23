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
import { formatPhoneIN, normaliseToE164 } from "@/lib/phone";
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

  const memberPhone = m.phone ? normaliseToE164(m.phone) : null;
  const showMemberPhone = !m.isMinor || m.guardians.length === 0 ||
    (memberPhone !== null && !m.guardians.some((guardian) => guardian.phone && normaliseToE164(guardian.phone) === memberPhone));

  return (
    <StaffPage>
      <BackLink href="/coach/members" label="Members" />

      <div className="flex items-start gap-3" data-testid="coach-member-identity">
        <PersonAvatar name={m.fullName} seed={m.memberId} size={48} className="flex-none" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink">
            {m.fullName}
          </h1>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
            {m.memberCode}
            {m.isMinor ? " · minor" : ""}
            {m.batches.length > 0 ? ` · ${m.batches.join(", ")}` : ""}
          </p>
        </div>
      </div>

      <nav aria-label="Member sections" className="mt-3 flex flex-wrap gap-2">
        <Link href="#attendance" replace prefetch={false} className={buttonClasses({ variant: "secondary", size: "sm" })}>Attendance</Link>
        {ladderEnabled ? <Link href="#progress" replace prefetch={false} className={buttonClasses({ variant: "secondary", size: "sm" })}>Progress</Link> : null}
      </nav>

      <section aria-labelledby="contact-and-safety" className={`mt-4 p-4 ${STAFF_CARD}`}>
        <h2 id="contact-and-safety" className="text-[15px] font-semibold text-ink">Contact and safety</h2>
        {m.isMinor && m.guardians.length > 0 ? (
          <ul aria-label="Guardians" className="mt-2 divide-y divide-line">
            {m.guardians.map((guardian, index) => (
              <li key={index} className="flex flex-wrap items-center justify-between gap-x-3 py-1.5">
                <div className="min-w-0">
                  <p className="break-words text-[14px] font-medium text-ink">{guardian.fullName}</p>
                  <p className="text-[12px] text-ink-3">Guardian</p>
                </div>
                <CoachContact name={guardian.fullName} phone={guardian.phone} />
              </li>
            ))}
          </ul>
        ) : null}
        {showMemberPhone ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3">
            <p className="text-[13px] font-medium text-ink-2">Member phone</p>
            <CoachContact name={m.fullName} phone={m.phone} />
          </div>
        ) : null}
        <div className="mt-2 border-t border-line pt-3">
          <p className="text-[13px] font-medium text-ink-2">Medical notes</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-snug text-ink">
            {m.medicalNotes ?? <span className="text-ink-3">None on file.</span>}
          </p>
        </div>
      </section>

      <AbsenceAlertsList alerts={alerts} />

      <div id="attendance" tabIndex={-1} className="scroll-mt-24">
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
      </div>

      {ladderEnabled ? (
        <div id="progress" tabIndex={-1} className="scroll-mt-24">
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
                  aria-label="Record assessment"
                  className={buttonClasses({ variant: "primary", size: "sm" })}
                >
                  Assess
                </Link>
              ) : null
            }
          >
            <MemberProgressPanel progress={progress} />
          </StaffSection>
        </div>
      ) : null}
    </StaffPage>
  );
}

function CoachContact({ name, phone }: { name: string; phone: string | null }) {
  const display = formatPhoneIN(phone);
  const number = phone ? normaliseToE164(phone) : "";
  if (!/^\+[1-9]\d{7,14}$/.test(number)) {
    return <p className="break-words text-[13px] text-ink-3">{display || "No phone on file"}</p>;
  }
  return (
    <a href={`tel:${number}`} aria-label={`Call ${name}`}
      className="inline-flex min-h-11 items-center rounded-ctl px-2 text-[13px] font-medium text-water underline">
      {display}
    </a>
  );
}
