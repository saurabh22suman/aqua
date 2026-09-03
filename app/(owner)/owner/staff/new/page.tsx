import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { StaffCreateForm } from "@/components/staff-create-form";

// Phase 3.5 — staff create form. Single primary action, two
// adjacent surface patterns: "new person" or "existing person
// id" — the latter is the path when a member is being made
// staff (a coach who happens to be enrolled).
export default function StaffCreatePage() {
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
        Add the person to the directory first, then invite them to log in from the staff invitations surface.
      </p>

      <div className="mt-6">
        <StaffCreateForm />
      </div>
    </main>
  );
}
