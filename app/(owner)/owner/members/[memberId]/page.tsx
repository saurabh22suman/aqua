import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck, Pencil, ShieldCheck, Users } from "lucide-react";
import { getMemberDetailAction } from "@/lib/actions/people";
import { getMemberAttendanceHistoryAction } from "@/lib/actions/attendance";
import { MemberStatusPanel } from "@/components/member-status-panel";
import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";
import { ParentLinkPanel } from "@/components/parent-link-panel";
import { MEMBER_STATUS_LABELS } from "@/lib/member-status-graph";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const [member, attendanceHistory] = await Promise.all([
    getMemberDetailAction(memberId),
    getMemberAttendanceHistoryAction(memberId),
  ]);
  if (!member) notFound();

  return (
    <main className="px-5 pt-10 pb-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-[19px] font-semibold">{member.fullName}</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {member.memberCode} · {member.locationName}
            {member.isMinor ? " · minor" : ""}
          </p>
        </div>
        <Link
          href={`/owner/members/${member.memberId}/edit`}
          className="flex items-center gap-1.5 rounded-ctl border border-line px-3 py-2 text-[13px]"
        >
          <Pencil size={14} />
          Edit
        </Link>
      </div>

      <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
        <p className="text-[12px] text-ink-3">Status</p>
        <p className="mt-0.5 font-display text-[16px] font-semibold">
          {MEMBER_STATUS_LABELS[member.status]}
        </p>
        <MemberStatusPanel memberId={member.memberId} status={member.status} />
      </div>

      <MemberEnrolmentPanel memberId={member.memberId} />

      <ParentLinkPanel
        memberId={member.memberId}
        memberName={member.fullName}
        primaryGuardianName={
          Array.isArray(member.guardians) && member.guardians.length > 0
            ? member.guardians[0]!.fullName
            : null
        }
      />

      <dl className="mt-4 rounded-card border border-line bg-paper p-3.5 space-y-2 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-ink-3">Phone</dt>
          <dd>{member.phone ?? "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-3">Date of birth</dt>
          <dd>{member.dateOfBirth ?? "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-3">Gender</dt>
          <dd className="capitalize">{member.gender ?? "—"}</dd>
        </div>
        {member.medicalNotes ? (
          <div>
            <dt className="text-ink-3">Medical notes</dt>
            <dd className="mt-0.5">{member.medicalNotes}</dd>
          </div>
        ) : null}
      </dl>

      {member.isMinor ? (
        <section className="mt-4">
          <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
            <Users size={15} className="text-ink-3" />
            Guardians
          </h2>
          {member.guardians.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">No guardian on file.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
              {member.guardians.map((g) => (
                <li key={g.personId} className="px-3.5 py-2.5 text-[13px]">
                  <span className="font-medium">{g.fullName}</span>
                  <span className="text-ink-3"> — {g.relationship}</span>
                  {g.phone ? <span className="text-ink-3"> · {g.phone}</span> : null}
                  {g.isPrimary ? <span className="ml-1.5 text-[11px] text-water">primary</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="mt-4">
        <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
          <ShieldCheck size={15} className="text-ink-3" />
          Consent
        </h2>
        {member.consents.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-3">No consent on file.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {member.consents.map((c, i) => (
              <li key={i} className="px-3.5 py-2.5 text-[13px]">
                <span className="capitalize font-medium">{c.purpose}</span>
                <span className="text-ink-3">
                  {" "}
                  — {c.withdrawnAt ? `withdrawn ${new Date(c.withdrawnAt).toLocaleDateString("en-IN")}` : "active"},
                  granted by {c.granterName || "self"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {member.statusHistory.length > 0 ? (
        <section className="mt-4">
          <h2 className="font-display text-[14px] font-semibold">Status history</h2>
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {member.statusHistory.map((h, i) => (
              <li key={i} className="px-3.5 py-2.5 text-[13px]">
                <span className="font-medium">
                  {MEMBER_STATUS_LABELS[h.fromStatus as keyof typeof MEMBER_STATUS_LABELS] ?? h.fromStatus} →{" "}
                  {MEMBER_STATUS_LABELS[h.toStatus as keyof typeof MEMBER_STATUS_LABELS] ?? h.toStatus}
                </span>
                <span className="text-ink-3"> — {h.reason ?? "no reason given"}</span>
                <p className="text-[11px] text-ink-3">{new Date(h.changedAt).toLocaleString("en-IN")}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-4">
        <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
          <CalendarCheck size={15} className="text-ink-3" />
          Attendance this month
        </h2>
        <div className="mt-2 rounded-card border border-line bg-paper p-3.5">
          <p className="font-display text-[24px] font-semibold">
            {attendanceHistory.pct === null ? "—" : `${attendanceHistory.pct}%`}
          </p>
          <p className="text-[12px] text-ink-3">
            {attendanceHistory.totalCount === 0
              ? "No sessions marked yet this month."
              : `${attendanceHistory.presentCount} of ${attendanceHistory.totalCount} sessions present`}
          </p>
        </div>
        {attendanceHistory.rows.length > 0 ? (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {attendanceHistory.rows.map((r) => (
              <li key={r.sessionId} className="flex items-center justify-between px-3.5 py-2.5 text-[13px]">
                <span>
                  {r.sessionDate} · {r.batchName}
                </span>
                <span
                  className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                    r.status === "present"
                      ? "bg-good-soft text-good"
                      : r.status === "late"
                        ? "bg-warn-soft text-warn"
                        : "bg-late-soft text-late"
                  }`}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
