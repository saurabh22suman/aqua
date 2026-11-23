import type { Metadata } from "next";
import { MyLeaveCard } from "@/components/my-leave-card";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";
import { StaffSectionError } from "@/components/staff-ui/staff-self-service-error";
import { listLeaveTypesAction, listMyLeaveAction } from "@/lib/actions/leave";
import { requireWorkerPage } from "@/lib/auth/worker-page";
import { todayInZone } from "@/lib/time/tz";

export const metadata: Metadata = { title: { absolute: "Leave · Aqua" } };

export default async function WorkerLeavePage() {
  await requireWorkerPage();
  const year = Number(todayInZone("Asia/Kolkata").slice(0, 4));
  const [types, leave] = await Promise.allSettled([
    listLeaveTypesAction(),
    listMyLeaveAction({ year }),
  ]);

  return (
    <StaffPage>
      <StaffPageHeader title="Leave" />
      {types.status === "fulfilled" && leave.status === "fulfilled" ? (
        <MyLeaveCard types={types.value} {...leave.value} showHeading={false} />
      ) : (
        <StaffSectionError sectionId="my-leave" title="Leave unavailable" message="Could not load balances and requests."
          retryHref="/worker/leave" retryLabel="Retry leave" />
      )}
    </StaffPage>
  );
}
