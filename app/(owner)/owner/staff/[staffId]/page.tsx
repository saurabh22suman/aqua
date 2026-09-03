import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listStaffAction } from "@/lib/actions/staff";
import { titleCase } from "@/lib/terminology/keys";

// Phase 3.5 — staff detail view. Read-only at this phase;
// edit + delete land with 3.6 (invitations), where the
// "rescind an invite" and "remove staff" actions are
// designed together — both involve the same audit + state
// machine.
export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = await params;
  const rows = await listStaffAction({});
  const staff = rows.find((r) => r.id === staffId);
  if (!staff) notFound();

  const initials =
    staff.fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";

  return (
    <main className="px-5 pt-6 pb-8">
      <Link
        href="/owner/staff"
        className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink mb-4"
      >
        <ChevronLeft size={16} />
        Staff
      </Link>

      <div className="bg-paper border border-line rounded-card px-5 py-5 flex items-center gap-4">
        <div className="h-14 w-14 rounded-[16px] bg-water-soft text-water grid place-items-center font-display text-[18px] font-semibold flex-none">
          {initials}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-[19px] font-semibold leading-tight truncate">
            {staff.fullName}
          </h1>
          <p className="text-[13px] text-ink-3 mt-0.5">
            {titleCase(staff.staffType)}
            {staff.employedOn ? ` · employed ${staff.employedOn}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-5 bg-paper border border-line rounded-card overflow-hidden">
        <div className="grid grid-cols-3 px-4 py-3 border-b border-line last:border-b-0">
          <p className="text-[13px] text-ink-3">Status</p>
          <div className="col-span-2">
            <p className="text-[14px]">{staff.userId ? "Has login" : "No login"}</p>
            <p className="text-[12px] text-ink-3 mt-0.5">
              {staff.userId
                ? "Sign in via the staff login flow (3.6 invitations wires this)."
                : "Has no user account yet. Use the invitations surface to send a login link."}
            </p>
          </div>
        </div>
      </div>

      <p className="mt-6 text-[12.5px] text-ink-3 leading-snug">
        Removing or changing a staff role lands with 3.6 — the same audit-trail and invitation-revoke path
        covers both edit and dismiss.
      </p>
    </main>
  );
}
