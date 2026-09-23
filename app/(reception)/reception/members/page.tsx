import Link from "next/link";
import { Search } from "lucide-react";
import { listMembersAction } from "@/lib/actions/people";
import { requireReception } from "@/lib/auth/surface-guard";
import { formatPhoneIN } from "@/lib/phone";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, MEMBER_STATUS_TONE } from "@/components/ui/StatusBadge";

// PR3-C7 — reception member search. The counter's fastest path to a
// record: one query by name, phone or member code; results link
// straight into the member page (enrol, invoice, payment).
export default async function ReceptionMembersPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  await requireReception();
  const params = searchParams ? await searchParams : {};
  const query = (params.q ?? "").trim();
  const members = query.length > 0 ? await listMembersAction({ search: query }) : [];

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Find a member
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Search by name, phone or member code.
      </p>

      <form method="get" className="mt-5">
        <label className="block" htmlFor="member-search">
          <span className="sr-only">Search members</span>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
              aria-hidden="true"
            />
            <input
              id="member-search"
              name="q"
              defaultValue={query}
              placeholder="Name, phone or member code"
              className="w-full rounded-ctl border border-line bg-paper py-3 pl-9 pr-3 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none"
            />
          </div>
        </label>
        <button
          type="submit"
          className="mt-2 w-full rounded-pill px-5 py-3 text-[14px] font-semibold text-paper bg-[var(--accent-strong)]"
        >
          Search
        </button>
      </form>

      {query.length === 0 ? (
        <p className="mt-5 text-[13px] text-ink-3">
          Start typing to find someone.
        </p>
      ) : members.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No members match"
            body={`Nothing on this academy matches “${query}”.`}
            secondaryAction={{
              label: "Add a member",
              href: "/reception/members/new",
            }}
          />
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {members.map((member) => (
            <li key={member.memberId}>
              <Link
                href={`/reception/members/${member.memberId}`}
                className="flex items-center gap-3 rounded-card border border-line bg-paper px-3.5 py-3"
                data-testid={`member-result-${member.memberId}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">
                    {member.fullName}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {member.memberCode} · {member.locationName}
                    {member.phone ? ` · ${formatPhoneIN(member.phone)}` : ""}
                  </p>
                </div>
                <StatusBadge tone={MEMBER_STATUS_TONE[member.status] ?? "neutral"}>
                  {member.status}
                </StatusBadge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
