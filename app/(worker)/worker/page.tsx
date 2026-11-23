import { StaffInboxLink } from "@/components/announcements/staff-inbox-link";
import { MyAttendanceCard } from "@/components/my-attendance-card";
import { STAFF_CARD, StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";
import { StaffSectionError, StaffSelfServiceError } from "@/components/staff-ui/staff-self-service-error";
import { listMyShiftsAction } from "@/lib/actions/shifts";
import { getMyAttendanceAction } from "@/lib/actions/staff-attendance";
import { requireWorkerPage } from "@/lib/auth/worker-page";
import { addDays, formatFullDateIST, formatTimeIST, formatWeekdayDateIST, todayInZone } from "@/lib/time/tz";

export default async function WorkerHomePage() {
  await requireWorkerPage();
  const today = todayInZone("Asia/Kolkata");
  const [shifts, attendance] = await Promise.allSettled([
    listMyShiftsAction({ fromDate: today, toDate: addDays(today, 13) }),
    getMyAttendanceAction({ date: today }),
  ]);

  const roster = shifts.status === "fulfilled" ? shifts.value : [];
  const now = Date.now();
  const currentShift = roster.find(shift => Date.parse(shift.startAt) <= now && Date.parse(shift.endAt) >= now);
  const nextShift = currentShift ?? roster.find(shift => Date.parse(shift.startAt) > now);
  const allUnavailable = shifts.status === "rejected" && attendance.status === "rejected";

  return (
    <StaffPage>
      <StaffPageHeader title="My workday" meta={formatFullDateIST(today)} />
      {allUnavailable ? (
        <StaffSelfServiceError retryHref="/worker" message="Could not load your work details. Try again for shifts and attendance." />
      ) : (
        <>
          {shifts.status === "rejected" ? (
            <StaffSectionError sectionId="my-shifts" title="Shifts unavailable" message="Could not load your shifts."
              retryHref="/worker" retryLabel="Retry shifts" />
          ) : (
            <section aria-labelledby="worker-brief-title" data-testid="worker-home-brief" className={`mt-5 p-4 ${STAFF_CARD}`}>
              {nextShift ? (
                <>
                  <p className="text-[12px] font-medium text-ink-3">{currentShift ? "Current shift" : "Next shift"}</p>
                  <h2 id="worker-brief-title" className="mt-1 break-words text-[20px] font-medium leading-tight text-ink">
                    {formatTimeIST(nextShift.startAt)} – {formatTimeIST(nextShift.endAt)}
                  </h2>
                  <p className="mt-1 text-[13px] text-ink-3">
                    {nextShift.shiftDate === today ? "Today" : formatWeekdayDateIST(`${nextShift.shiftDate}T12:00:00Z`)}
                  </p>
                </>
              ) : (
                <h2 id="worker-brief-title" className="text-[16px] font-medium text-ink">No upcoming shift</h2>
              )}
            </section>
          )}
          {attendance.status === "fulfilled" ? (
            <MyAttendanceCard attendance={attendance.value} date={today} id="today-attendance" />
          ) : (
            <StaffSectionError sectionId="today-attendance" title="Today's attendance"
              message="Attendance unavailable. Try again to check in or out."
              retryHref="/worker" retryLabel="Retry attendance" />
          )}
        </>
      )}
      <StaffInboxLink href="/worker/announcements" />
    </StaffPage>
  );
}
