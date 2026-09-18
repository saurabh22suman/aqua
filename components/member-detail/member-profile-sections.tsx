import { CalendarCheck, ShieldCheck, Users } from "lucide-react";
import { MemberAttendanceGrid } from "@/components/member-detail/member-attendance-grid";
import { MEMBER_STATUS_LABELS } from "@/lib/member-status-graph";
import { resolveTerm, type TerminologyState } from "@/lib/terminology/keys";
import { formatDateIST } from "@/lib/time/tz";
import type { MemberDetail } from "@/lib/services/people";
import type { MemberAttendanceHistory } from "@/lib/services/attendance-history";

// U-03 — the member overview's read-only profile sections, extracted
// from the page so the page itself stays a tab switch plus the header.
// Guardians, consent, status history and the attendance grid.

export function MemberProfileSections({
  member,
  attendanceHistory,
  terminology,
}: {
  member: MemberDetail;
  attendanceHistory: MemberAttendanceHistory & { today: string };
  terminology: TerminologyState;
}) {
  return (
    <>
      {member.isMinor ? (
        <section className="mt-4">
          <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
            <Users size={15} className="text-ink-3" />
            Guardians
          </h2>
          {member.guardians.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">
              No {resolveTerm(terminology, "guardian", 1)} on file.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
              {member.guardians.map((g) => (
                <li key={g.personId} className="px-3.5 py-2.5 text-[13px]">
                  <span className="font-medium">{g.fullName}</span>
                  <span className="text-ink-3"> — {g.relationship}</span>
                  {g.phone ? (
                    <span className="text-ink-3"> · {g.phone}</span>
                  ) : null}
                  {g.isPrimary ? (
                    <span className="ml-1.5 text-[11px] text-water">primary</span>
                  ) : null}
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
                  —{" "}
                  {c.withdrawnAt
                    ? `withdrawn ${formatDateIST(c.withdrawnAt)}`
                    : "active"}
                  , granted by {c.granterName || "self"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {member.statusHistory.length > 0 ? (
        <section className="mt-4">
          <h2 className="font-display text-[14px] font-semibold">
            Status history
          </h2>
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {member.statusHistory.map((h, i) => (
              <li key={i} className="px-3.5 py-2.5 text-[13px]">
                <span className="font-medium">
                  {MEMBER_STATUS_LABELS[
                    h.fromStatus as keyof typeof MEMBER_STATUS_LABELS
                  ] ?? h.fromStatus}{" "}
                  →{" "}
                  {MEMBER_STATUS_LABELS[
                    h.toStatus as keyof typeof MEMBER_STATUS_LABELS
                  ] ?? h.toStatus}
                </span>
                <span className="text-ink-3"> — {h.reason ?? "no reason given"}</span>
                <p className="text-[11px] text-ink-3">
                  {formatDateIST(h.changedAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-4">
        <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
          <CalendarCheck size={15} className="text-ink-3" />
          Attendance
        </h2>
        <MemberAttendanceGrid
          rows={attendanceHistory.rows}
          today={attendanceHistory.today}
        />
      </section>
    </>
  );
}
