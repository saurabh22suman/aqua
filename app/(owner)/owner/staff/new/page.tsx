import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { StaffCreateForm } from "@/components/staff-create-form";
import { getTerminologyAction } from "@/lib/actions/terminology";

// Phase 3.5 — staff create form. Single primary action, two
// adjacent surface patterns: "new person" or "existing person
// id" — the latter is the path when a member is being made
// staff (a coach who happens to be enrolled).
//
// Add vs. invite are two surfaces for two intents: this page adds
// a staff record with no login (e.g. a worker paid in cash who
// doesn't need app access). The invitations surface sends a
// phone-OTP invite; if the user is new, the invite creates both
// the directory entry and the login in one step. Both cross-link
// inline so the operator doesn't need to back out to navigate
// between them.
export default async function StaffCreatePage() {
  // L3 audit — the staff-type option labelled "Coach" routes
  // through the closed-key `coach` resolver so a gym / multi-sport
  // tenant renders "Trainer", a dance / martial-arts tenant
  // renders "Instructor".
  const terminology = await getTerminologyAction();
  return (
    <main className="px-5 pt-6 pb-8">
      <Link
        href="/owner/staff"
        className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink mb-4"
      >
        <ChevronLeft size={16} />
        Staff
      </Link>
      <h1 className="font-display text-[19px] font-semibold">Add staff</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Add a staff record without sending a login invite. Use this for
        workers paid in cash who don&apos;t need app access.
      </p>
      <Link
        href="/owner/staff/invitations/new"
        className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
      >
        Want to send a login invite instead? Go to Invitations →
      </Link>

      <div className="mt-6">
        <StaffCreateForm terminology={terminology} />
      </div>
    </main>
  );
}
