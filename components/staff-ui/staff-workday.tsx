import { MyAttendanceCard } from "@/components/my-attendance-card";
import { MyLeaveCard } from "@/components/my-leave-card";
import { MyShiftsCard } from "@/components/my-shifts-card";
import {
  StaffSectionError,
  StaffSelfServiceError,
} from "@/components/staff-ui/staff-self-service-error";
import type {
  LeaveBalanceRow,
  LeaveRequestRow,
  LeaveTypeRow,
} from "@/lib/services/leave";
import type { MyAttendanceRow } from "@/lib/services/staff-attendance";
import type { MyShiftRow } from "@/lib/services/shifts";

// finish/staff workday — the caller's own shifts, attendance and leave
// settle independently.
//
// The three cards used to share one Promise.all: any failed read hid the
// whole block behind a single error, even when the other sections had
// loaded. A failed read is still not an empty list, so each section keeps
// its own unavailable state and retry while the readable sections render.
// Identity is resolved by the page and may degrade on its own; it never
// takes the reads with it.

export type StaffWorkdaySection<T> =
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "unavailable" };

export type StaffLeaveRead = {
  readonly types: LeaveTypeRow[];
  readonly balances: LeaveBalanceRow[];
  readonly requests: LeaveRequestRow[];
};

export type StaffWorkday = {
  readonly shifts: StaffWorkdaySection<MyShiftRow[]>;
  readonly attendance: StaffWorkdaySection<MyAttendanceRow | null>;
  readonly leave: StaffWorkdaySection<StaffLeaveRead>;
  /** Every self-service section failed; the page keeps its all-failed error. */
  readonly allUnavailable: boolean;
};

export type StaffLeaveHistoryRead = {
  balances: LeaveBalanceRow[];
  requests: LeaveRequestRow[];
};

export type StaffWorkdaySettled = {
  shifts: PromiseSettledResult<MyShiftRow[]>;
  attendance: PromiseSettledResult<MyAttendanceRow | null>;
  leaveTypes: PromiseSettledResult<LeaveTypeRow[]>;
  leave: PromiseSettledResult<StaffLeaveHistoryRead>;
};

/**
 * Maps the four independent reads to sections. Leave types and leave
 * history stay one section because MyLeaveCard needs both to render;
 * one failing read means the leave card is unavailable, never partial.
 */
function settleStaffWorkday({
  shifts,
  attendance,
  leaveTypes,
  leave,
}: StaffWorkdaySettled): StaffWorkday {
  const shiftsSection: StaffWorkdaySection<MyShiftRow[]> =
    shifts.status === "fulfilled"
      ? { status: "ready", value: shifts.value }
      : { status: "unavailable" };

  const attendanceSection: StaffWorkdaySection<MyAttendanceRow | null> =
    attendance.status === "fulfilled"
      ? { status: "ready", value: attendance.value }
      : { status: "unavailable" };

  const leaveSection: StaffWorkdaySection<StaffLeaveRead> =
    leaveTypes.status === "fulfilled" && leave.status === "fulfilled"
      ? {
          status: "ready",
          value: {
            types: leaveTypes.value,
            balances: leave.value.balances,
            requests: leave.value.requests,
          },
        }
      : { status: "unavailable" };

  return {
    shifts: shiftsSection,
    attendance: attendanceSection,
    leave: leaveSection,
    allUnavailable:
      shiftsSection.status === "unavailable" &&
      attendanceSection.status === "unavailable" &&
      leaveSection.status === "unavailable",
  };
}

export type StaffWorkdayInputs = {
  shifts: Promise<MyShiftRow[]>;
  attendance: Promise<MyAttendanceRow | null>;
  leaveTypes: Promise<LeaveTypeRow[]>;
  leave: Promise<StaffLeaveHistoryRead>;
};

/** Starts the caller's own reads in parallel and lets each one settle. */
export async function loadStaffWorkday(
  inputs: StaffWorkdayInputs,
): Promise<StaffWorkday> {
  const [shifts, attendance, leaveTypes, leave] = await Promise.allSettled([
    inputs.shifts,
    inputs.attendance,
    inputs.leaveTypes,
    inputs.leave,
  ] as const);

  return settleStaffWorkday({ shifts, attendance, leaveTypes, leave });
}

/**
 * The account page's self-service block. Every section is independent;
 * when all three fail, the existing whole-block error is still shown so
 * the reader gets one calm statement instead of three identical cards.
 * Each section retry is a native link to the current page; the failed
 * section stays in its own place, so recovery keeps its context.
 */
export function StaffWorkdaySections({
  workday,
  pageHref,
  date,
}: {
  workday: StaffWorkday;
  pageHref: string;
  date: string;
}) {
  if (workday.allUnavailable) {
    return <StaffSelfServiceError retryHref={pageHref} />;
  }

  return (
    <>
      {workday.attendance.status === "ready" ? (
        <MyAttendanceCard
          attendance={workday.attendance.value}
          date={date}
          id="today-attendance"
        />
      ) : (
        <StaffSectionError
          sectionId="today-attendance"
          title="Today's attendance"
          message="Could not load today's attendance. Check-in and check-out are unavailable right now."
          retryHref={pageHref}
          retryLabel="Retry attendance"
        />
      )}

      {workday.shifts.status === "ready" ? (
        <div id="my-shifts" className="scroll-mt-4">
          <MyShiftsCard shifts={workday.shifts.value} />
        </div>
      ) : (
        <StaffSectionError
          sectionId="my-shifts"
          title="My shifts"
          message="Could not load your shifts."
          retryHref={pageHref}
          retryLabel="Retry shifts"
        />
      )}

      {workday.leave.status === "ready" ? (
        <div id="my-leave" className="scroll-mt-4">
          <MyLeaveCard
            types={workday.leave.value.types}
            balances={workday.leave.value.balances}
            requests={workday.leave.value.requests}
          />
        </div>
      ) : (
        <StaffSectionError
          sectionId="my-leave"
          title="Leave"
          message="Could not load your leave. Try again to see your balances and requests."
          retryHref={pageHref}
          retryLabel="Retry leave"
        />
      )}
    </>
  );
}
