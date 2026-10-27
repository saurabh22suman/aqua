import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listStaffAction } from "@/lib/actions/staff";
import { titleCase } from "@/lib/terminology/keys";
import { formatDateIST } from "@/lib/time/tz";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { getCurriculumLeadState } from "@/lib/services/curriculum-lead";
import { CurriculumLeadControl } from "@/components/curriculum-lead-control";

// Phase 3.5 — staff detail view. Read-only at this phase;
// edit + delete land with 3.6 (invitations), where the
// "rescind an invite" and "remove staff" actions are
// designed together — both involve the same audit + state
// machine.
//
// R02 (2026-10-13 role-workflow audit) — the one delegated change
// this page carries: the owner/admin can designate a coach as the
// academy's curriculum lead or remove that delegation.
export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.read");
  const { staffId } = await params;
  const rows = await listStaffAction({});
  const staff = rows.find((r) => r.id === staffId);
  if (!staff) notFound();

  const canDelegate = hasPermission(ctx, "settings.manage");
  const curriculumState =
    canDelegate && staff.staffType === "coach"
      ? await getCurriculumLeadState(ctx, staffId)
      : null;

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
            {staff.employedOn ? ` · employed ${formatDateIST(staff.employedOn)}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-5 bg-paper border border-line rounded-card overflow-hidden">
        <div className="grid grid-cols-3 px-4 py-3 border-b border-line last:border-b-0">
          {/* Owner redesign (C2) + P2 (independent review) — the
              profile states login access in the same words as the staff
              directory, and it states only what it knows: a linked
              identity is not an active login, because a revoked
              invitation leaves the link in place. */}
          <p className="text-[13px] text-ink-3">Login access</p>
          <div className="col-span-2">
            <p className="text-[14px]">
              {staff.userId ? "Linked" : "Not linked"}
            </p>
            <p className="text-[12px] text-ink-3 mt-0.5">
              {staff.userId
                ? "A phone-based login is linked to this record — they sign in with their phone number and PIN, no separate password. The Invitations surface holds the current access state."
                : "No login is linked to this record. Send an invite from the invitations surface to add one."}
            </p>
          </div>
        </div>
      </div>

      {curriculumState ? (
        <CurriculumLeadControl
          staffId={staff.id}
          fullName={staff.fullName}
          state={curriculumState}
        />
      ) : null}

      <p className="mt-6 text-[12.5px] text-ink-3 leading-snug">
        This profile is read-only. Manage login access from{" "}
        <Link
          href="/owner/staff/invitations"
          className="text-[var(--accent-ink)] underline underline-offset-2"
        >
          Invitations
        </Link>
        .
      </p>
    </main>
  );
}
