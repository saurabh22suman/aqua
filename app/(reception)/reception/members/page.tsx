import Link from "next/link";
import { listMembersAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { DEFAULT_TERMS } from "@/lib/terminology/keys";
import { requireReception } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { formatPhoneIN } from "@/lib/phone";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, MEMBER_STATUS_TONE } from "@/components/ui/StatusBadge";
import { Input } from "@/components/ui/Input";
import { Button, buttonClasses } from "@/components/ui/Button";
import { PersonAvatar } from "@/components/avatar";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { STAFF_CARD, StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";
import { StaffCreateAction } from "@/components/staff-ui/staff-create-action";

// PR3-C7 — reception member search. The counter's fastest path to a
// record: one query by name, phone or member code; results link
// straight into the member page (enrol, invoice, payment).
export default async function ReceptionMembersPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const ctx = await requireReception();
  const [params, terminology] = await Promise.all([
    searchParams ?? Promise.resolve({} as { q?: string }),
    getTerminologyAction(),
  ]);
  const query = (params.q ?? "").trim();
  const members = query.length > 0 ? await listMembersAction({ search: query }) : [];
  const memberNoun = DEFAULT_TERMS[terminology.locale].member.one;
  const memberNouns = DEFAULT_TERMS[terminology.locale].member.other;
  const canCreate = hasPermission(ctx, "members.write");

  return (
    <StaffPage className={canCreate ? "pb-24" : undefined}>
      <StaffPageHeader
        title={`Find a ${memberNoun}`}
        meta="Search by name, phone or member code."
        action={
          canCreate ? (
            <span className="hidden lg:block">
              <Link
                href="/reception/members/new"
                className={buttonClasses({
                  variant: "primary",
                  size: "sm",
                })}
              >
                Add {memberNoun}
              </Link>
            </span>
          ) : undefined
        }
      />

      <form method="get" className="mt-5">
        <label className="block" htmlFor="member-search">
          <span className="sr-only">Search {memberNouns}</span>
          <div className="relative">
            <OwnerIcon
              name="search"
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <Input
              id="member-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Name, phone or code"
              className="pl-11"
            />
          </div>
        </label>
        <Button type="submit" variant="primary" className="mt-2 w-full">
          Search
        </Button>
      </form>

      {query.length === 0 ? (
        <p className="mt-5 text-[13px] text-ink-3">
          Start typing to find someone.
        </p>
      ) : members.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No matches"
            body={`Nothing on this academy matches “${query}”.`}
            // The empty state may only offer a create path to a caller
            // who holds members.write. The contextual "+" and the
            // labelled desktop create are gated on the same grant; an
            // ungated action here would advertise a capability the
            // caller's grants refuse.
            secondaryAction={
              canCreate
                ? {
                    label: `Add a ${memberNoun}`,
                    href: "/reception/members/new",
                  }
                : undefined
            }
          />
        </div>
      ) : (
        <ul className={`mt-5 divide-y divide-line ${STAFF_CARD}`}>
          {members.map((member) => (
            <li key={member.memberId}>
              <Link
                href={`/reception/members/${member.memberId}`}
                className="flex items-center gap-3 px-3.5 py-3 transition-colors duration-150 hover:bg-deck/50 active:bg-deck"
                data-testid={`member-result-${member.memberId}`}
              >
                <PersonAvatar
                  name={member.fullName}
                  seed={member.memberId}
                  size={36}
                  className="flex-none"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">
                    {member.fullName}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-ink-3">
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

      {canCreate ? (
        <StaffCreateAction
          href="/reception/members/new"
          label={`Add a ${memberNoun}`}
        />
      ) : null}
    </StaffPage>
  );
}
