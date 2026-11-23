import { StaffWorkdayLink } from "@/components/staff-ui/staff-workday-link";
import Link from "next/link";
import { getTodayAction } from "@/lib/actions/coach";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { staffTerminology } from "@/lib/terminology/staff-terms";
import { listStaffAttendanceDayAction } from "@/lib/actions/staff-attendance";
import { ReceptionCheckIns } from "@/components/reception-check-ins";
import { StaffAttendanceBoard } from "@/components/staff-attendance-board";
import { CountChip } from "@/components/ui/CountChip";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { guidePreferenceKey } from "@/components/onboarding/guide-preference-key";
import { requireReception } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { formatFullDateIST, todayInZone } from "@/lib/time/tz";
import {
  StaffNavCard,
  StaffPage,
  StaffPageHeader,
  StaffSection,
} from "@/components/staff-ui/staff-page";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { buttonClasses } from "@/components/ui/Button";

// Reception's Today surface. The first card answers the counter's first
// job — find the right member or invoice — and keeps dues one tap away.
// The day's check-ins follow, then the authorised counter tools. Every
// entry is gated by grant AND entitlement so a tap never lands on a
// refused action.
export default async function ReceptionTodayPage() {
  const ctx = await requireReception();
  const canMark = hasPermission(ctx, "attendance.mark");
  const canMarkStaff = hasPermission(ctx, "staff.attendance");
  const canCollect = hasPermission(ctx, "payments.record") && hasFeature(ctx, "billing");
  const canCloseDay = canCollect;
  const canSeeDues = hasPermission(ctx, "invoices.read") && hasFeature(ctx, "billing");
  const canUseCafe = hasPermission(ctx, "payments.record") && hasFeature(ctx, "cafe.pos");
  const today = todayInZone("Asia/Kolkata");
  const retryHref = "/reception";
  const [checkIns, terminology, staffRows] = await Promise.all([
    getTodayAction().catch(() => null),
    getTerminologyAction().then(staffTerminology),
    canMarkStaff ? listStaffAttendanceDayAction({ date: today }).catch(() => null) : Promise.resolve([]),
  ]);

  const sessions = checkIns?.sessions;
  const memberNoun = resolveTerm(terminology, "member", 1);
  const checkedInSessions = sessions?.filter((session) => session.total > 0 && session.marked > 0).length;

  return (
    <StaffPage>
      <StaffPageHeader
        title="Today"
        meta={formatFullDateIST(today)}
        action={sessions ? (
          <CountChip
            count={sessions.length}
            label={sessions.length === 1 ? "session" : "sessions"}
            tone={sessions.length === 0 ? "neutral" : "warn"}
          />
        ) : null}
      />

      <section
        className="mt-5 overflow-hidden rounded-2xl border border-line bg-paper"
        aria-labelledby="reception-brief-title"
        data-testid="reception-home-brief"
      >
        <div className="p-4">
          <h2
            id="reception-brief-title"
            className="mt-1 text-[20px] font-medium leading-tight tracking-[-0.01em] text-ink"
          >
            At the counter
          </h2>
          <nav aria-label="Counter shortcuts" className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,7.5rem),1fr))]">
            <Link
              href="/reception/members"
              className={buttonClasses({
                variant: "primary",
                size: "sm",
                className: "w-full min-w-0 text-center [&>svg]:shrink-0",
              })}
              data-testid="member-search-link"
            >
              <OwnerIcon name="search" size={18} />
              Find a {memberNoun}
            </Link>
            {canCollect ? (
              <Link href="/reception/collect-payment" data-testid="collect-payment-link"
                aria-label="Collect payment"
                className={buttonClasses({ variant: "secondary", size: "sm", className: "w-full [&>svg]:shrink-0" })}>
                <OwnerIcon name="money" size={17} />
                Collect
              </Link>
            ) : null}
            {canSeeDues ? (
              <Link
                href="/reception/dues"
                className={buttonClasses({
                  variant: "secondary",
                  size: "sm",
                  className: "w-full",
                })}
                data-testid="dues-link"
              >
                Dues
              </Link>
            ) : null}
          </nav>
        </div>
        {sessions ? <div className="border-t border-line px-4 py-2.5">
          <p className="text-[12px] leading-snug text-ink-3">
            {sessions.length === 0
              ? "No sessions on today's check-in list."
              : `${checkedInSessions} of ${sessions.length} ${
                  sessions.length === 1 ? "session has" : "sessions have"
                } a mark recorded.`}
          </p>
        </div> : null}
      </section>

      {sessions ? <ReceptionCheckIns sessions={sessions} canMark={canMark} /> : (
        <StaffSection title="Today's check-ins">
          <div className="mt-2 rounded-card border border-line bg-paper p-4">
            <p role="alert" className="text-[13px] text-ink-2">Could not load today&apos;s check-ins.</p>
            <a href={retryHref} className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-2" })}>
              Retry today&apos;s check-ins
            </a>
          </div>
        </StaffSection>
      )}

      <StaffWorkdayLink ctx={ctx} href="/reception/workday" />

      {canCloseDay || canUseCafe ? (
        <StaffSection
          title="Counter tools"
        >
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {canCloseDay ? (
              <StaffNavCard
                href="/reception/close"
                icon="check"
                label="Close day"
                description="Count cash"
                testId="close-day-link"
              />
            ) : null}

            {canUseCafe ? (
              <StaffNavCard
                href="/reception/cafe"
                icon="booking"
                label="Café"
                description="Take orders"
                testId="cafe-link"
              />
            ) : null}
          </div>
        </StaffSection>
      ) : null}

      {canMarkStaff ? staffRows ? (
        <StaffAttendanceBoard date={today} rows={staffRows} canMark />
      ) : (
        <StaffSection title="Staff attendance">
          <p role="alert" className="mt-2 text-[13px] text-ink-2">Could not load staff attendance.</p>
          <a href={retryHref} className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-2" })}>
            Retry staff attendance
          </a>
        </StaffSection>
      ) : null}


      <OptionalWorkspaceGuide
        key={guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey)}
        startCollapsed
        preferenceKey={guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey)}
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
    </StaffPage>
  );
}
