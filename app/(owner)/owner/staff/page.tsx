import Link from "next/link";
import { listStaffAction } from "@/lib/actions/staff";
import { StaffBoard } from "@/components/staff-board";

// Phase 3.5 — staff directory. List page reachable from
// Settings > Academy.
export default async function StaffListPage() {
  const rows = await listStaffAction({});
  return (
    <main className="px-5 pt-6 pb-8">
      <div className="flex items-center justify-between gap-3 pb-4">
        <h1 className="font-display text-[19px] font-semibold">Staff</h1>
        <Link
          href="/owner/staff/new"
          className="rounded-pill px-4 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)]"
        >
          Add staff
        </Link>
      </div>

      <p className="text-[13px] text-ink-3">
        The people who run the academy. A single person can hold multiple roles (e.g. coach and receptionist).
      </p>

      <div className="mt-5">
        <StaffBoard rows={rows} />
      </div>
    </main>
  );
}
