import Link from "next/link";
import Briefcase from "lucide-react/dist/esm/icons/briefcase.mjs";
import { PersonAvatar } from "@/components/avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { StaffRow } from "@/lib/services/staff";
import { titleCase } from "@/lib/terminology/keys";
import { formatDateIST } from "@/lib/time/tz";

// Owner OpenPen management lane (29 October 2026).
//
// A directory RECORD and a login ACCESS are different things, so the
// table states the access state in words ("Linked" / "Not linked")
// instead of burying it in a meta sentence. A linked identity is NOT an
// active login: revokeInvitation leaves staff.userId in place while the
// tenant membership becomes "revoked", so the row claims only what it
// knows.
//
// Desktop uses the reference's aligned columns (Staff member / Staff
// type / Login / Employed on / action). The phone renders identity-first
// cards; the table is not shrunk into an unreadable grid.

const TYPE_LABEL: Record<StaffRow["staffType"], string> = {
  coach: "Coach",
  receptionist: "Receptionist",
  worker: "Worker",
  accountant: "Accountant",
};

function typeLabel(row: StaffRow): string {
  return titleCase(TYPE_LABEL[row.staffType]);
}

function LoginState({ linked }: { linked: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-ink-3 md:sr-only">Login access</span>
      <StatusBadge tone="neutral">{linked ? "Linked" : "Not linked"}</StatusBadge>
    </span>
  );
}

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
    <div data-testid="staff-list">
      <table
        aria-label="Team directory"
        className="hidden w-full border-collapse text-[13px] md:table"
      >
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-ink-3">
            <th scope="col" className="py-2.5 pr-3 font-medium">
              Staff member
            </th>
            <th scope="col" className="py-2.5 pr-3 font-medium">
              Staff type
            </th>
            <th scope="col" className="py-2.5 pr-3 font-medium">
              Login
            </th>
            <th scope="col" className="py-2.5 pr-3 font-medium">
              Employed on
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line last:border-0">
              <td className="py-3 pr-3">
                <Link
                  href={`/owner/staff/${row.id}`}
                  className="flex min-h-11 items-center gap-2.5"
                >
                  <PersonAvatar
                    seed={row.personId}
                    size={32}
                    className="flex-none"
                  />
                  <span className="text-[14px] font-medium leading-tight text-ink">
                    {row.fullName}
                  </span>
                </Link>
              </td>
              <td className="py-3 pr-3 text-ink-2">{typeLabel(row)}</td>
              <td className="py-3 pr-3">
                <LoginState linked={Boolean(row.userId)} />
              </td>
              <td className="py-3 pr-3 tabular-nums text-ink-2">
                {row.employedOn ? formatDateIST(row.employedOn) : "—"}
              </td>
              <td className="py-3 text-right">
                <Link
                  href={`/owner/staff/${row.id}`}
                  aria-label={`Open ${row.fullName}`}
                  className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/owner/staff/${row.id}`}
              className="flex items-start gap-3 py-3"
            >
              <PersonAvatar
                seed={row.personId}
                size={36}
                className="flex-none"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium leading-tight text-ink">
                  {row.fullName}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                  {typeLabel(row)}
                  {row.employedOn
                    ? ` · Employed ${formatDateIST(row.employedOn)}`
                    : ""}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <LoginState linked={Boolean(row.userId)} />
                </span>
              </span>
              <span
                aria-hidden="true"
                className="mt-1 flex-none text-[13px] text-ink-3"
              >
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
