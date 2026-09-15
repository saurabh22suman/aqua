import { notFound } from "next/navigation";
import { Phone, Stethoscope, Users } from "lucide-react";
import { getCoachMemberDetailAction } from "@/lib/actions/coach";
import { listMemberAlertsAction } from "@/lib/actions/absence-alerts";
import { AbsenceAlertsList } from "@/components/absence-alerts-list";
import { MemberAttendanceGrid } from "@/components/member-detail/member-attendance-grid";
import { requireCoach } from "@/lib/auth/surface-guard";
import { formatPhoneIN } from "@/lib/phone";
import { BackLink } from "@/components/ui/BackLink";
import { requireUuidParam } from "@/lib/params";

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
  await requireCoach();
  const { memberId } = await params;
  requireUuidParam(memberId);
  const [m, alerts] = await Promise.all([
    getCoachMemberDetailAction(memberId),
    // R.8 — read-only attendance alerts for this member.
    listMemberAlertsAction(memberId),
  ]);
  if (!m) notFound();

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/coach/members" label="Members" />

      <h1 className="font-display text-[19px] font-semibold leading-tight">
        {m.fullName}
      </h1>
      <p className="mt-0.5 text-[12.5px] text-ink-3">
        {m.memberCode}
        {m.isMinor ? " · minor" : ""}
        {m.batches.length > 0 ? ` · ${m.batches.join(", ")}` : ""}
      </p>

      <section className="mt-5 rounded-card border border-line bg-paper p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <Phone size={15} className="text-ink-3 mt-0.5 flex-none" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-ink-3 font-medium">
              Phone
            </p>
            <p className="mt-0.5 text-[14px] font-mono">
              {m.phone ? (
                formatPhoneIN(m.phone)
              ) : (
                <span className="text-ink-3">No phone on file</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <Stethoscope size={15} className="text-ink-3 mt-0.5 flex-none" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-ink-3 font-medium">
              Medical notes
            </p>
            <p className="mt-0.5 text-[13.5px] leading-snug">
              {m.medicalNotes ?? <span className="text-ink-3">None on file.</span>}
            </p>
          </div>
        </div>
      </section>

      <AbsenceAlertsList alerts={alerts} />

      {m.isMinor && m.guardians.length > 0 ? (
        <section className="mt-4">
          <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
            <Users size={15} className="text-ink-3" />
            Guardians
          </h2>
          <p className="mt-1 text-[12px] text-ink-3">
            Who to call if something goes wrong.
          </p>
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {m.guardians.map((g, i) => (
              <li key={i} className="px-3.5 py-2.5 text-[13px]">
                <p className="font-medium">{g.fullName}</p>
                <p className="mt-0.5 font-mono text-ink-2">
                  {g.phone ? (
                    formatPhoneIN(g.phone)
                  ) : (
                    <span className="text-ink-3">No phone on file</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-5">
        <h2 className="font-display text-[14px] font-semibold">Attendance</h2>
        <MemberAttendanceGrid
          rows={m.attendance.rows}
          today={m.attendance.today}
          scopeNote="Counts only sessions from batches you coach."
          registerBasePath="/coach/register"
        />
      </section>
    </main>
  );
}
