import { notFound } from "next/navigation";
import { Phone, Stethoscope, Users } from "lucide-react";
import { getCoachMemberDetailAction } from "@/lib/actions/coach";
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
  const m = await getCoachMemberDetailAction(memberId);
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
        <h2 className="font-display text-[14px] font-semibold">
          Last 90 days
        </h2>
        <div className="mt-2 rounded-card border border-line bg-paper p-4">
          <div className="flex items-baseline justify-between">
            <p className="font-display text-[24px] font-semibold">
              {m.attendance.pct === null ? "—" : `${m.attendance.pct}%`}
            </p>
            <p className="text-[12px] text-ink-3">
              {m.attendance.totalCount === 0
                ? "No sessions marked yet"
                : `${m.attendance.presentCount} of ${m.attendance.totalCount} sessions present`}
            </p>
          </div>
          {m.attendance.totalCount > 0 ? (
            <p className="mt-1.5 text-[11.5px] text-ink-3">
              Counts only sessions from batches you coach.
            </p>
          ) : null}
        </div>

        {m.attendance.rows.length > 0 ? (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {m.attendance.rows.map((r) => (
              <li
                key={r.sessionId}
                className="flex items-center justify-between px-3.5 py-2.5 text-[13px]"
              >
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
