import Link from "next/link";
import { Briefcase, ChevronRight } from "lucide-react";
import { PersonAvatar } from "@/components/avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { StaffRow } from "@/lib/services/staff";
import { titleCase } from "@/lib/terminology/keys";
import { formatDateIST } from "@/lib/time/tz";

// Phase 3.5 — staff directory surface. One dominant element (the
// list itself), a verb-CTA in the empty state, per-row member code
// + name + staff type pill. Reachable from Settings > Academy.
//
// Owner redesign (C2) — a directory RECORD and a login ACCESS are
// different things, so the row states the access state in words
// ("Login access · Active" / "Login access · No access") instead of
// burying it in a meta sentence. The employment date is printed in
// the readable form (DESIGN.md §4), not as a raw ISO string.

const TYPE_LABEL: Record<StaffRow["staffType"], string> = {
  coach: "Coach",
  receptionist: "Receptionist",
  worker: "Worker",
  accountant: "Accountant",
};

export function StaffBoard({ rows }: { rows: StaffRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-ctl border border-line bg-paper">
        <EmptyState
          icon={<Briefcase size={18} strokeWidth={2} aria-hidden="true" />}
          title="No staff yet"
          body="Add the people who run the academy — coaches, receptionists, anyone who needs to mark attendance or accept fees."
          action={{
            label: "Add your first staff member",
            href: "/owner/staff/new",
          }}
        />
      </div>
    );
  }

  return (
    <ul data-testid="staff-list">
      {rows.map((r) => {
        return (
          <li key={r.id} className="bg-paper border border-line rounded-ctl mb-2 last:mb-0">
            <Link
              href={`/owner/staff/${r.id}`}
              className="flex items-start gap-3 px-3.5 py-3"
            >
              {/* U-09 — deterministic avatar seeded by the stable
                  person id, never the display name. Decorative here:
                  the name sits right next to it. */}
              <PersonAvatar seed={r.personId} size={36} className="flex-none" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium leading-tight truncate">{r.fullName}</p>
                <p className="mt-0.5 text-[12px] text-ink-3 truncate">
                  {titleCase(TYPE_LABEL[r.staffType])}
                  {r.employedOn ? ` · Employed ${formatDateIST(r.employedOn)}` : ""}
                </p>
                {/* P2 (independent review) — a linked identity is NOT
                    an active login: revokeInvitation leaves staff.userId
                    in place while the tenant membership becomes
                    "revoked". The row therefore states only what it
                    knows (the identity is linked) and the Invitations
                    surface holds the access state. */}
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
                  <span>Login access</span>
                  {r.userId ? (
                    <StatusBadge tone="neutral">Linked</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Not linked</StatusBadge>
                  )}
                </p>
              </div>
              <ChevronRight size={18} className="mt-1 text-ink-3 flex-none" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
