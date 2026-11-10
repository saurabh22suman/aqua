// The Members directory's list — the count, the rows and the empty
// states.
//
// PRESENTATION ONLY. The board owns the state, the navigation state
// and every read; this file draws what the board decides to show. The
// three empty states are chosen by the board and arrive as ONE kind, so
// this file can never invent a state of its own:
//
//   "failed"   — a read failed; the alert beside the list owns the
//                failure and offers the retry, so the list says nothing;
//   "no-match" — a search or a status filter matched nothing; the way
//                out is the secondary "Clear filters" action;
//   "empty"    — the facility holds nobody; nothing was searched.

import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { PersonAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, MEMBER_STATUS_TONE } from "@/components/ui/StatusBadge";
import { formatPhoneIN } from "@/lib/phone";
import { titleCase } from "@/lib/terminology/keys";
import type { MemberListRow } from "@/lib/services/people";

/** Which empty state the list is in. The board decides; this draws. */
export type MemberListEmptyKind = "failed" | "no-match" | "empty";

export function MemberList({
  members,
  memberTerm,
  statusLabels,
  emptyKind,
  onClearFilters,
  scopeQuery,
  onOpen,
  isPending,
  canWrite,
}: {
  members: MemberListRow[];
  /** The tenant's own word for a member: the singular and the plural. */
  memberTerm: { one: string; other: string };
  /** The visible word for each status. */
  statusLabels: Record<string, string>;
  emptyKind: MemberListEmptyKind;
  /** The way out of a filter that matched nothing. */
  onClearFilters: () => void;
  /** The scope the drill-down carries. */
  scopeQuery: string;
  /** The owner is leaving for a profile: the board remembers the list. */
  onOpen: () => void;
  isPending: boolean;
  /**
   * Whether the caller may add a member. The add verb is offered only
   * where it is permitted ("No members yet → 'Add member', where
   * permitted" — UI-UX.txt §6).
   */
  canWrite: boolean;
}) {
  const memberSingular = titleCase(memberTerm.one);

  return (
    <section className="mt-4 rounded-card border border-line bg-paper">
      {/* The page title already says what this is; a second visible
          heading repeated it. The LIST keeps its accessible name, and
          the count stays — it is the one useful thing the card's
          header can say. */}
      <div className="flex justify-end px-3.5 pt-3.5">
        <span className="text-[12px] text-ink-3 tabular-nums">{members.length} {members.length === 1 ? "record" : "records"}</span>
      </div>
      <ul className="md:px-3.5" data-testid="members-list" aria-busy={isPending} aria-label={`${memberSingular} directory`}>
        {members.length === 0 ? (
          // A FAILED read is not an empty list. The alert above owns
          // the failure and offers the retry, so the list must not
          // also claim that the filter answered the question.
          emptyKind === "failed" ? null : (
            <li className="list-none py-2">
              {emptyKind === "no-match" ? (
                <>
                  <EmptyState
                    title={`No ${memberTerm.other} match.`}
                    body="Try a different name, phone number or status."
                  />
                  {/* The way out of a filter that matched nothing: a
                      SECONDARY action, so it never competes with the
                      page's own create action. The negative margin
                      pulls it back under the empty state's own
                      padding — the shared empty state owns the
                      shape, this owns the verb. */}
                  <div className="-mt-6 flex justify-center pb-8">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onClearFilters}
                      data-testid="members-clear-filters"
                    >
                      Clear filters
                    </Button>
                  </div>
                </>
              ) : (
                <EmptyState
                  title={`No ${memberTerm.other} yet.`}
                  body={
                    canWrite
                      ? `Add your first ${memberTerm.one} to start building the roster.`
                      : `Your role can view ${memberTerm.other} but not add them.`
                  }
                />
              )}
            </li>
          )
        ) : (
          members.map((m) => (
            <li key={m.memberId} className="border-b border-line px-3.5 last:border-0 md:px-0">
              <Link
                href={`/owner/members/${m.memberId}${scopeQuery}`}
                data-testid="member-row"
                onClick={onOpen}
                className="flex min-h-16 items-center gap-3 py-3"
              >
                {/* The SHARED person avatar owns the initials: the first
                    GRAPHEME of each of the first two words, so an Indian
                    conjunct (क्षा) and a combining mark (E + U+0301) stay
                    whole, on the theme's own surface. No photo, no
                    generated art, no upload, no new asset. */}
                <PersonAvatar
                  name={m.fullName}
                  seed={m.personId}
                  size={40}
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span data-testid="member-row-name" className="block break-words text-[14px] font-medium text-ink">
                    {m.fullName}{m.isMinor ? <span className="text-[11px] text-ink-3">{" (minor)"}</span> : null}
                  </span>
                  <span data-testid="member-row-meta" className="mt-0.5 block text-[12px] text-ink-3">
                    {/* Each fact is its own group: the code and the
                        facility may break, and the phone is ONE
                        group that may not break inside itself — a
                        number split across two lines is unreadable
                        (measured at 390px). The groups themselves may
                        wrap onto the next line. */}
                    <span className="break-words">{m.memberCode} · {m.locationName}</span>
                    {m.phone ? (
                      <>
                        {" · "}
                        <span data-testid="member-row-phone" className="whitespace-nowrap">{formatPhoneIN(m.phone)}</span>
                      </>
                    ) : null}
                  </span>
                </span>
                <span data-testid="member-row-status" className="shrink-0">
                  <StatusBadge tone={MEMBER_STATUS_TONE[m.status] ?? "neutral"}>{statusLabels[m.status]}</StatusBadge>
                </span>
                <span aria-hidden="true" className="hidden text-[12px] text-ink-3 md:inline">Open</span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
