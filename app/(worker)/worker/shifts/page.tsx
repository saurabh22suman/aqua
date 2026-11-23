import type { Metadata } from "next";
import Link from "next/link";
import { MyShiftsCard } from "@/components/my-shifts-card";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";
import { StaffSectionError } from "@/components/staff-ui/staff-self-service-error";
import { buttonClasses } from "@/components/ui/Button";
import { listMyShiftsAction } from "@/lib/actions/shifts";
import { requireWorkerPage } from "@/lib/auth/worker-page";
import { addDays, todayInZone } from "@/lib/time/tz";

export const metadata: Metadata = { title: { absolute: "Schedule · Aqua" } };

export default async function WorkerShiftsPage() {
  await requireWorkerPage();
  const today = todayInZone("Asia/Kolkata");
  const shifts = await listMyShiftsAction({ fromDate: today, toDate: addDays(today, 13) }).catch(() => null);

  return (
    <StaffPage>
      <StaffPageHeader
        title="Schedule"
        meta={shifts?.length ? "Next 14 days" : undefined}
        action={<Link href="/worker/leave" className={buttonClasses({ size: "sm" })}>Leave</Link>}
      />
      {shifts ? <MyShiftsCard shifts={shifts} showHeading={false} /> : (
        <StaffSectionError sectionId="my-shifts" title="Shifts unavailable" message="Could not load your shifts."
          retryHref="/worker/shifts" retryLabel="Retry shifts" />
      )}
    </StaffPage>
  );
}
