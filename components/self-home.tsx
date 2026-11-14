import Link from "next/link";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { GuideHelpButton } from "@/components/onboarding/guide-help-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { MEMBER_STATUS_TONE, StatusBadge } from "@/components/ui/StatusBadge";
import { SelfSignOut } from "@/components/self-sign-out";
import type { SelfHomeView } from "@/lib/services/self-home";
import { ClubMark } from "@/components/branding/club-mark";

// THE MEMBER AND FAMILY HOME.
//
// It shows the REAL record the resolved scope names: the club, and the
// membership(s) the scope is bound to. The member view shows the
// member's own membership; the family view shows ONLY the currently
// linked child memberships.
//
// It reads no phone number, no medical note, no invoice, no payment and
// no attendance, and it invents nothing: no balance, no next session, no
// count of anything. A long name wraps; the page scrolls once, as the
// document, and the shared tokens carry both light presets.

const STATUS_LABEL: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  paused: "Paused",
  lapsed: "Lapsed",
  left: "Left",
};

export function SelfHome({
  view,
  audience,
  scopeKind,
  tenantId,
  canViewOwnBilling = null,
  guideKey,
}: {
  view: SelfHomeView & { clubLogoUrl?: string | null };
  audience: "member" | "guardian";
  scopeKind: "self_session" | "staff_session";
  tenantId: string;
  canViewOwnBilling?: boolean | null;
  guideKey?: string;
}) {
  const family = audience === "guardian";
  const duplicateNames = new Set(view.entries.filter((entry, index, all) =>
    all.some((other, otherIndex) => otherIndex !== index && other.fullName === entry.fullName),
  ).map((entry) => entry.fullName));
  // Describe only controls already present in this rendered home. The guide
  // carries no member identifiers, names or financial facts to the client.
  const guideItems = [{
    key: "membership",
    title: family ? "Linked memberships" : "Your membership",
    detail: view.entries.length === 0
      ? "Ask your club to help link a membership."
      : "Review the membership details shown on this page.",
  }];
  if (view.entries.length > 0) {
    if (scopeKind === "staff_session" && tenantId) {
      guideItems.push({ key: "sign-in", title: "Sign in to continue", detail: "Use the sign-in links on a membership to view fees or manage achievements." });
    } else if (scopeKind === "self_session") {
      if (family || canViewOwnBilling === true) {
        guideItems.push({ key: "fees", title: "Fees and payments", detail: family ? "Choose a linked membership to view its fees and payments." : "Open your fees and payments from your membership." });
      }
      guideItems.push({ key: "achievements", title: "Achievements page", detail: family ? "Choose a linked membership to open its achievements page." : "Open your achievements page from your membership." });
    }
  }
  return (
    <main className="min-h-dvh bg-deck px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-[640px]">
        <header className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <div className="flex min-w-0 w-full items-start gap-3 sm:flex-1">
            <ClubMark name={view.clubName} logoUrl={view.clubLogoUrl} size={32} />
            <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ink-3">
              {family ? "Family view" : "Member view"}
            </p>
            <h1 className="mt-1 break-words font-display text-[22px] font-semibold leading-tight text-ink">
              {view.clubName}
            </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3"><GuideHelpButton homeHref={family ? "/family" : "/member"} /><SelfSignOut audience={audience} /></div>
        </header>

        <Link href={`/clubs/${tenantId}/install?source=${scopeKind === "staff_session" ? "staff" : audience}`} prefetch={false} className="mt-4 inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">
          Install this club
        </Link>

        <OptionalWorkspaceGuide
          key={guideKey}
          startCollapsed
          preferenceKey={guideKey}
          items={guideItems}
          title={family ? "Explore your family view" : "Explore your member view"}
          intro="Take a quick look at this page. You can skip the guide and reopen it here."
          regionLabel={family ? "Optional family guide" : "Optional member guide"}
          itemLabel="Page feature"
        />

        {scopeKind === "self_session" ? (
          <Link
            href={family ? "/family/announcements" : "/member/announcements"}
            className="mt-4 inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2"
          >
            Announcements
          </Link>
        ) : null}

        <Card className="mt-6 overflow-hidden">
          <CardHeader>
            <CardTitle>
              {family ? "Linked memberships" : "Your membership"}
            </CardTitle>
          </CardHeader>
          {view.entries.length === 0 ? (
            <CardContent>
              <p className="text-[14px] leading-relaxed text-ink-2">
                {family
                  ? "No membership is linked here yet. Ask your club to link your child's membership."
                  : "No membership is linked here yet. Ask your club to check your link."}
              </p>
            </CardContent>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {view.entries.map((entry) => (
                <li
                  key={entry.memberId}
                  className="px-5 py-4"
                >
                  <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-display text-[16px] font-semibold leading-snug text-ink">
                      {entry.fullName}
                    </p>
                    <p className="mt-1 break-words text-[13px] text-ink-2">
                      Member code {entry.memberCode}
                    </p>
                    <p className="break-words text-[13px] text-ink-2">
                      {entry.facilityName ?? "Facility not recorded"}
                    </p>
                  </div>
                  <StatusBadge
                    tone={MEMBER_STATUS_TONE[entry.status] ?? "neutral"}
                  >
                    {STATUS_LABEL[entry.status] ?? entry.status}
                  </StatusBadge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {!family && scopeKind === "self_session" && canViewOwnBilling !== true ? (
                    <p className="text-[13px] text-ink-2">{canViewOwnBilling === false ? "A linked guardian can view fees and payments for this membership." : "Fees are temporarily unavailable. Please try again."}</p>
                  ) : (
                    <Link
                      aria-label={family ? `${scopeKind === "staff_session" ? "Sign in to view fees" : "Fees and payments"} for ${entry.fullName}${duplicateNames.has(entry.fullName) ? `, member code ${entry.memberCode}` : ""}` : undefined}
                      href={scopeKind === "staff_session"
                        ? `${family ? "/family" : "/member"}/sign-in?clubId=${encodeURIComponent(tenantId)}`
                        : family ? `/family/billing/${entry.memberId}` : "/member/billing"}
                      className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
                    >
                      {scopeKind === "staff_session" ? "Sign in to view fees" : "Fees and payments"}
                    </Link>
                  )}
                  <Link
                    aria-label={family ? `${scopeKind === "staff_session" ? "Sign in to manage achievements" : "Achievements page"} for ${entry.fullName}${duplicateNames.has(entry.fullName) ? `, member code ${entry.memberCode}` : ""}` : undefined}
                    href={scopeKind === "staff_session"
                      ? `${family ? "/family" : "/member"}/sign-in?clubId=${encodeURIComponent(tenantId)}`
                      : family ? `/family/showcase/${entry.memberId}` : "/member/showcase"}
                    className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
                  >
                    {scopeKind === "staff_session"
                      ? "Sign in to manage achievements"
                      : family ? "Achievements page" : "Your achievements page"}
                  </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
