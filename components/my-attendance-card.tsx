import { Clock } from "lucide-react";
import { getMyAttendanceAction } from "@/lib/actions/staff-attendance";
import { formatTimeIST, todayInZone } from "@/lib/time/tz";
import { StaffCheckInControls } from "@/components/staff-check-in-controls";

// V-24 — the staff member's own attendance on the Me tab: today's
// state plus check-in/out. Reads through getMyAttendanceAction
// (staff.self), so the card can only ever show the caller's own row.

export async function MyAttendanceCard() {
  const today = todayInZone("Asia/Kolkata");
  const row = await getMyAttendanceAction({ date: today });

  const checkedIn = Boolean(row?.checkedInAt);
  const checkedOut = Boolean(row?.checkedOutAt);

  let summary = "Not checked in yet.";
  if (checkedIn && row?.checkedInAt) {
    summary = `Checked in ${formatTimeIST(row.checkedInAt)}`;
    if (row.lateMinutes > 0) summary += ` · ${row.lateMinutes} min late`;
    if (checkedOut && row.checkedOutAt) {
      summary += ` · out ${formatTimeIST(row.checkedOutAt)}`;
    }
  } else if (row && !checkedIn) {
    summary =
      row.note ??
      `Marked ${row.status.replace("_", " ")} for today.`;
  }

  return (
    <section className="mt-5 rounded-card border border-line bg-paper p-4">
      <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
        <Clock size={15} className="text-ink-3" />
        Today&apos;s attendance
      </h2>
      <p className="mt-2 text-[13px] text-ink-2">{summary}</p>
      <StaffCheckInControls checkedIn={checkedIn} checkedOut={checkedOut} />
    </section>
  );
}
