import Link from "next/link";
import { listInvitationsAction } from "@/lib/actions/staff-invitations";
import { InvitationsBoard } from "@/components/invitations-board";

// Phase 3.6 — staff invitations surface. List + revoke + resend.
// The "accept" step is the invitee signing in with the phone
// they were invited with — that flips status 'invited' to
// 'active' through better-auth's callbackOnVerification (no
// separate UI on this side).
export default async function StaffInvitationsPage() {
  const rows = await listInvitationsAction();
  return (
    <main className="px-5 pt-6 pb-8">
      <div className="flex items-center justify-between gap-3 pb-4">
        <h1 className="font-display text-[19px] font-semibold">Invitations</h1>
        <Link
          href="/owner/staff/invitations/new"
          className="rounded-pill px-4 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)]"
        >
          Invite staff
        </Link>
      </div>
      <p className="text-[13px] text-ink-3">
        Pending and active staff. Revoke an active row to remove the person from the academy.
      </p>
      <div className="mt-5">
        <InvitationsBoard rows={rows} />
      </div>
    </main>
  );
}
