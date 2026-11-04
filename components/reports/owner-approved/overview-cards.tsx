import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import type { AttendanceByBatchInsight } from "@/lib/services/owner-insights";
import { OwnerIcon, type OwnerIconName } from "@/components/owner-ui/owner-icon";

// The Owner card glyphs are the shared Owner outline set (Foundation owns
// the geometry; ICON-ADDENDUM 2 Nov 2026). The approved mock has exact
// glyphs for members, staff and money. A batch report is a LIST of
// scheduled groups, which is what the mock's own `programs` list glyph
// draws, so batches maps to it and the mapping is documented here rather
// than silently substituting other imagery.
const TILE_ICON: Record<"members" | "staff" | "batches" | "payments", OwnerIconName> = {
  members: "members",
  staff: "staff",
  batches: "programs",
  payments: "money",
};

export function OverviewAttendance({ data, href }: { data: AttendanceByBatchInsight | null; href: string }) {
  const marks = data?.summary.marks;
  const rate = marks?.total ? Math.round((marks.present + marks.late) * 100 / marks.total) : null;
  const register = data?.summary.register;
  return <Link href={href} className="block rounded-card bg-[var(--owner-hero)] p-5 text-[var(--owner-hero-ink)]"><div className="flex items-start justify-between gap-4"><div><h2 className="font-display text-lg font-semibold">Attendance</h2><p className="mt-3 font-display text-3xl font-semibold">{data ? rate === null ? "No marks" : `${rate}%` : "Unavailable"}</p><p className="mt-1 text-sm">{marks?.total ? `${marks.present + marks.late} of ${marks.total} recorded marks present or late` : data ? "Present or late of recorded marks" : "Could not load attendance"}</p></div>{rate !== null ? <svg aria-hidden="true" viewBox="0 0 40 40" className="h-16 w-16 shrink-0"><circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="5" /><circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="5" strokeDasharray={`${rate} 100`} pathLength="100" transform="rotate(-90 20 20)" /></svg> : null}</div>{register ? <div className="mt-4">{register.sessionsWithRoster ? <div role="meter" aria-label="Register completion" aria-valuemin={0} aria-valuemax={register.sessionsWithRoster} aria-valuenow={register.completedRegisters} className="h-2 overflow-hidden rounded-pill bg-white/25"><div className="h-full bg-white" style={{ width: `${register.completedRegisters / register.sessionsWithRoster * 100}%` }} /></div> : null}<p className="mt-1 text-sm">{register.sessionsWithRoster ? `${register.completedRegisters} of ${register.sessionsWithRoster} registers complete` : "No registers with a roster"} · {register.unmarkedSlots} unmarked</p></div> : null}</Link>;
}

export function OverviewTile({ title, value, detail, href, tone, icon }: { title: string; value: string | null; detail?: string; href?: string; tone: "info" | "butter" | "money"; icon: "members" | "staff" | "batches" | "payments" }) {
  const colors = { info: "bg-tile-info", butter: "bg-tile-butter", money: "bg-tile-money" };
  const body = <><OwnerIcon name={TILE_ICON[icon]} size={20} className="mb-2 text-ink-2" /><h2 className="text-sm font-medium">{title}</h2><p className="mt-3 font-display text-2xl font-semibold">{value ?? "Unavailable"}</p>{detail ? <p className="mt-1 text-xs text-ink-2">{detail}</p> : null}</>;
  return href ? <Link href={href} className={`block min-w-0 rounded-card p-4 text-ink ${colors[tone]}`}>{body}</Link> : <section className={`min-w-0 rounded-card p-4 text-ink ${colors[tone]}`}>{body}</section>;
}
