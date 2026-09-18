import Link from "next/link";
import { Briefcase, ChevronRight } from "lucide-react";
import { PersonAvatar } from "@/components/avatar";
import type { StaffRow } from "@/lib/services/staff";
import { titleCase } from "@/lib/terminology/keys";

// Phase 3.5 — staff directory surface. One dominant element (the
// list itself), a verb-CTA in the empty state, per-row member code
// + name + staff type pill. Reachable from Settings > Academy.

const TYPE_LABEL: Record<StaffRow["staffType"], string> = {
  coach: "Coach",
  receptionist: "Receptionist",
  worker: "Worker",
  accountant: "Accountant",
};

export function StaffBoard({ rows }: { rows: StaffRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-ctl border border-line bg-paper px-5 py-10 text-center">
        <div className="mx-auto h-10 w-10 rounded-ctl bg-water-soft text-water grid place-items-center mb-3">
          <Briefcase size={18} strokeWidth={2} />
        </div>
        <p className="text-[15px] font-medium">No staff yet</p>
        <p className="mt-1 text-[13px] text-ink-3">
          Add the people who run the academy — coaches, receptionists, anyone who needs to mark attendance or accept fees.
        </p>
        <Link
          href="/owner/staff/new"
          className="mt-5 inline-flex items-center justify-center rounded-pill px-5 py-3 text-[14.5px] font-semibold text-paper bg-[var(--accent)]"
        >
          Add your first staff member
        </Link>
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
              className="flex items-center gap-3 px-3.5 py-3"
            >
              {/* U-09 — deterministic avatar seeded by the stable
                  person id, never the display name. Decorative here:
                  the name sits right next to it. */}
              <PersonAvatar seed={r.personId} size={36} className="flex-none" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium leading-tight truncate">{r.fullName}</p>
                <p className="mt-0.5 text-[12px] text-ink-3 truncate">
                  {titleCase(TYPE_LABEL[r.staffType])}
                  {r.userId ? " · has login" : " · no login yet"}
                  {r.employedOn ? ` · since ${r.employedOn}` : ""}
                </p>
              </div>
              <ChevronRight size={18} className="text-ink-3 flex-none" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
