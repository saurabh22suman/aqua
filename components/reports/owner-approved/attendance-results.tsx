import type { AttendanceByBatchInsight } from "@/lib/services/owner-insights";

export function AttendanceResults({ data }: { data: AttendanceByBatchInsight }) {
  const { marks, register } = data.summary;
  const rate = marks.total ? Math.round(((marks.present + marks.late) / marks.total) * 100) : null;
  return <section className="mt-4 rounded-card border border-line bg-paper p-4" aria-labelledby="attendance-summary-title">
    <h2 id="attendance-summary-title" className="font-display text-lg font-semibold">Recorded attendance</h2>
    {data.summary.sessions === 0 ? <p className="mt-3 text-sm text-ink-2">No sessions in this range.</p> : rate === null ? <p className="mt-3 text-sm text-ink-2">No attendance marks recorded in this range.</p> : <>
      <p className="mt-3 font-display text-2xl font-semibold">{rate}%</p>
      <p className="text-sm text-ink-2">Present or late among recorded marks</p>
      <div role="img" aria-label={`Recorded marks: ${marks.present} present, ${marks.late} late, ${marks.absent} absent`} className="mt-4 flex h-3 overflow-hidden rounded-pill bg-deck">
        <span className="bg-[var(--action-surface)]" style={{ width: `${marks.present / marks.total * 100}%` }} />
        <span className="bg-ink-3" style={{ width: `${marks.late / marks.total * 100}%` }} />
        <span className="bg-warn" style={{ width: `${marks.absent / marks.total * 100}%` }} />
      </div>
      <p className="mt-2 text-sm text-ink-2">{marks.present} present · {marks.late} late · {marks.absent} absent</p>
    </>}
    <p className="mt-4 text-sm text-ink-2">{register.sessionsWithRoster ? `${register.completedRegisters} of ${register.sessionsWithRoster} registers complete · ${register.unmarkedSlots} unmarked (unknown)` : "No registers with a roster in this range."}</p>
    {data.rows.length ? <ul aria-label="Attendance groups" className="mt-4 divide-y divide-line border-t border-line">{data.rows.map(row => <li key={row.batchId} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="font-medium">{row.batchName}</span><span className="text-ink-2">{row.marks.total} recorded</span></li>)}</ul> : null}
    <details className="mt-4 border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium text-ink">View data and method</summary>
      <p className="text-sm text-ink-2">Attendance uses recorded marks only. Unmarked roster places are unknown, not absent. A register is complete when every person on the historical roster has a mark.</p>
      {data.rows.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Attendance by group</caption><thead><tr><th scope="col">Group</th><th scope="col">Present</th><th scope="col">Late</th><th scope="col">Absent</th><th scope="col">Unmarked</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.batchId}><th scope="row" className="py-2 pr-3"><span>{row.batchName}</span>{row.programName ? ` · ${row.programName}` : ""}</th><td>{row.marks.present}</td><td>{row.marks.late}</td><td>{row.marks.absent}</td><td>{row.register.unmarkedSlots}</td></tr>)}</tbody></table></div> : null}
    </details>
  </section>;
}
