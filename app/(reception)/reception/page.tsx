import { getTodayAction } from "@/lib/actions/coach";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { listStaffAttendanceDayAction } from "@/lib/actions/staff-attendance";
import { ReceptionCheckIns } from "@/components/reception-check-ins";
import { StaffAttendanceBoard } from "@/components/staff-attendance-board";
import { CountChip } from "@/components/ui/CountChip";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { requireReception } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { formatFullDateIST, todayInZone } from "@/lib/time/tz";
import {
  StaffNavCard,
  StaffPage,
  StaffPageHeader,
} from "@/components/staff-ui/staff-page";

// Reception's Today surface. One compact grid of the destinations this
// counter is actually authorised to open, then the day's check-ins and
// staff attendance. Every entry is gated by grant AND entitlement so a
// tap never lands on a refused action.
export default async function ReceptionTodayPage() {
  const ctx = await requireReception();
  const [{ sessions }, terminology] = await Promise.all([
    getTodayAction(),
    getTerminologyAction(),
  ]);
  const canMark = hasPermission(ctx, "attendance.mark");
  const canMarkStaff = hasPermission(ctx, "staff.attendance");
  const canCollect = hasPermission(ctx, "payments.record") && hasFeature(ctx, "billing");
  const canCloseDay = canCollect;
  const canSeeDues = hasPermission(ctx, "invoices.read") && hasFeature(ctx, "billing");
  const canUseCafe = hasPermission(ctx, "payments.record") && hasFeature(ctx, "cafe.pos");
  const today = todayInZone("Asia/Kolkata");
  const staffRows = canMarkStaff
    ? await listStaffAttendanceDayAction({ date: today })
    : [];

  const memberNoun = resolveTerm(terminology, "member", 1);

  return (
    <StaffPage>
      <StaffPageHeader
        title="Today"
        meta={formatFullDateIST(today)}
        action={
          <CountChip
            count={sessions.length}
            label={sessions.length === 1 ? "session" : "sessions"}
          />
        }
      />

      <OptionalWorkspaceGuide
        startCollapsed
        title="A look around reception"
        intro="Explore the areas shown here at your own pace. This guide makes no changes."
        regionLabel="Optional reception guide"
        itemLabel="Reception area"
        items={[
          { key: "members", title: "Find a member", detail: "The member card opens the member search." },
          { key: "checkins", title: "Today's check-ins", detail: "The check-ins panel shows today's sessions." },
          ...(canMarkStaff ? [{ key: "staff", title: "Staff attendance", detail: "The staff attendance panel is shown below." }] : []),
        ]}
      />
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {canCollect ? (
          <StaffNavCard
            href="/reception/collect-payment"
            icon="money"
            label="Collect payment"
            description="Cash or UPI — verify at the counter."
            testId="collect-payment-link"
          />
        ) : null}

        {canCloseDay ? (
          <StaffNavCard
            href="/reception/close"
            icon="check"
            label="Close day"
            description="Count today's cash and close the counter."
            testId="close-day-link"
          />
        ) : null}

        {canSeeDues ? (
          <StaffNavCard
            href="/reception/dues"
            icon="invoice"
            label="Dues"
            description="Pending fees, overdue first."
            testId="dues-link"
          />
        ) : null}

        <StaffNavCard
          href="/reception/members"
          icon="search"
          label={`Find a ${memberNoun}`}
          description="Search by name, phone or code."
          testId="member-search-link"
        />

        {canUseCafe ? (
          <StaffNavCard
            href="/reception/cafe"
            icon="booking"
            label="Café"
            description="Take a counter order and settle it."
            testId="cafe-link"
          />
        ) : null}
      </div>

      <ReceptionCheckIns sessions={sessions} canMark={canMark} />

      {canMarkStaff ? (
        <StaffAttendanceBoard
          date={today}
          rows={staffRows}
          canMark={canMarkStaff}
        />
      ) : null}
    </StaffPage>
  );
}
