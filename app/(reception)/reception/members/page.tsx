import Link from "next/link";
import { listMembersAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { staffTerminology } from "@/lib/terminology/staff-terms";
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
import { ReceptionMemberResultLink } from "@/components/reception/member-search-navigation";
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
    getTerminologyAction().then(staffTerminology),
  ]);
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const members = query ? await listMembersAction({ search: query }).catch(() => null) : [];
  const navigationNamespace = `${ctx.tenantId}:${ctx.userId}`;
  const memberNoun = resolveTerm(terminology, "member", 1);
  const memberNouns = resolveTerm(terminology, "member", "other");
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

      <form id="reception-member-search" method="get" className={`mt-4 space-y-3 p-4 ${STAFF_CARD}`}>
        <label className="block" htmlFor="member-search">
          <span className="mb-1 block text-sm font-semibold">Search {memberNouns}</span>
          <div className="relative">
            <OwnerIcon
              name="search"
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <Input
              id="member-search"
              name="q"
              maxLength={200}
              type="search"
              defaultValue={query}
              placeholder="Name, phone or code"
              className="pl-11"
            />
          </div>
        </label>
        <Button type="submit" variant="primary" className="w-full">
          Search
        </Button>
      </form>

      {query.length === 0 ? (
        <p className="mt-5 text-[13px] text-ink-3">
          Start typing to find someone.
        </p>
      ) : members === null ? (
        <section className={`mt-4 space-y-2 p-4 ${STAFF_CARD}`}>
          <p role="alert" className="text-sm">Could not search. Check your connection and retry with the same details.</p>
          <Button type="submit" form="reception-member-search" size="sm">Retry search</Button>
        </section>
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
        <section className="mt-4" aria-label="Search results">
        <p role="status" className="mb-2 text-sm text-ink-2">{members.length} {members.length === 1 ? "match" : "matches"}</p>
        <ul className={`divide-y divide-line ${STAFF_CARD}`}>
          {members.map((member) => (
            <li key={member.memberId}>
              <ReceptionMemberResultLink memberId={member.memberId} namespace={navigationNamespace}
                className="flex min-h-16 items-start gap-3 px-3.5 py-3 transition-colors duration-150 hover:bg-deck/50 active:bg-deck">

                <PersonAvatar
                  name={member.fullName}
                  seed={member.memberId}
                  size={36}
                  className="flex-none"
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-[14px] font-semibold text-ink">
                    {member.fullName}
                  </p>
                  <p className="mt-0.5 break-words text-[12px] text-ink-3">
                    {member.memberCode} · {member.locationName}
                    {member.phone ? ` · ${formatPhoneIN(member.phone)}` : ""}
                  </p>
                </div>
                <StatusBadge tone={MEMBER_STATUS_TONE[member.status] ?? "neutral"}>
                  {member.status}
                </StatusBadge>
              </ReceptionMemberResultLink>
            </li>
          ))}
        </ul>
        </section>
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
