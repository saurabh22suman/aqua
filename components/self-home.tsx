import Link from "next/link";
import { SelfWorkspaceNav } from "@/components/self-workspace-nav";
import ReceiptIndianRupee from "lucide-react/dist/esm/icons/receipt-indian-rupee.mjs";
import Trophy from "lucide-react/dist/esm/icons/trophy.mjs";
import UserRound from "lucide-react/dist/esm/icons/user-round.mjs";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { GuideHelpButton } from "@/components/onboarding/guide-help-button";
import { MEMBER_STATUS_TONE, StatusBadge } from "@/components/ui/StatusBadge";
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
// count of anything. The actions lead to the existing fees, receipts,
// achievements and announcements surfaces, where the exact paise and
// records already live. A long name wraps; the page scrolls once, as the
// document, and the shared tokens carry both light presets.
//
// The composition follows the 21 November Owner Home mobile brief: a
// sticky brand bar, one 107px identity masthead, short cards and 44px
// actions. The route-scoped treatment lives in app/(self)/self-route.tsx,
// so no other role's shell changes.

const STATUS_LABEL: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  paused: "Paused",
  lapsed: "Lapsed",
  left: "Left",
};

const HOME_DATE = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Asia/Kolkata",
});

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
  const homeBase = family ? "/family" : "/member";
  const membershipIndex = family && view.entries.length > 1;
  const ownEntry = !family && view.entries.length === 1 ? view.entries[0] : undefined;
  const canOpenFees = family || canViewOwnBilling === true;
  const pairedActions = scopeKind === "self_session" && canOpenFees;

  return (
    <main className="self-page" data-self-view={audience}>
      <header className="self-topbar">
        <div className="self-toprow">
          <div className="self-brand">
            <ClubMark name={view.clubName} logoUrl={view.clubLogoUrl} size={30} />
            <div className="self-brandcopy">
              <strong>{view.clubName}</strong>
              <span>{family ? "Family view" : "Member view"}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="self-main">
        <SelfWorkspaceNav home={homeBase} current="home" showAnnouncements={scopeKind === "self_session"} />
        <section className="self-mast" aria-labelledby="self-home-club">
          <p className="self-mast-eyebrow">
            {ownEntry ? "Your membership" : family ? "Your family at" : "Your club"}
          </p>
          <h1 id="self-home-club">{ownEntry?.fullName ?? view.clubName}</h1>
          {ownEntry ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="self-mast-date !mt-0 [overflow-wrap:anywhere]">
                Member code {ownEntry.memberCode} · {ownEntry.facilityName ?? "Facility not recorded"}
              </p>
              <StatusBadge tone={MEMBER_STATUS_TONE[ownEntry.status] ?? "neutral"}>
                {STATUS_LABEL[ownEntry.status] ?? ownEntry.status}
              </StatusBadge>
            </div>
          ) : <p className="self-mast-date">{HOME_DATE.format(new Date())}</p>}
        </section>

        {membershipIndex ? (
          <nav className="self-card self-member-nav" aria-labelledby="self-choose-title">
            <h2 className="self-card-title" id="self-choose-title">
              Choose a membership
            </h2>
            <ul className="self-member-nav-list">
              {view.entries.map((entry, index) => (
                <li key={entry.memberId}>
                  <Link replace prefetch={false} href={`#member-${index + 1}`} className="self-member-nav-link">
                    <span className="self-member-nav-name">{entry.fullName}</span>
                    {duplicateNames.has(entry.fullName) ? (
                      <span className="self-member-nav-code">
                        Member code {entry.memberCode}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <section className="self-card" aria-labelledby="self-members-title">
          <div className="self-card-head">
            <div>
              <h2 className="self-card-title" id="self-members-title">
                {ownEntry ? "Membership tools" : family ? "Linked memberships" : "Your membership"}
              </h2>
            </div>
            {family && view.entries.length > 0 ? (
              <span className="self-count" aria-hidden="true">
                {view.entries.length}
              </span>
            ) : null}
          </div>
          {view.entries.length === 0 ? (
            <div className="self-empty">
              <p>
                <strong>No membership is linked here yet.</strong>
              </p>
              <p>
                {family
                  ? "Ask your club to link your child's membership."
                  : "Ask your club to check your membership link."}
              </p>
            </div>
          ) : (
            <ul className="self-list">
              {view.entries.map((entry, index) => (
                <li
                  key={entry.memberId}
                  id={family ? `member-${index + 1}` : undefined}
                  tabIndex={family ? -1 : undefined}
                  className="self-member"
                >
                  {ownEntry ? null : <div className="self-member-head">
                    <span className="self-member-icon" aria-hidden="true">
                      <UserRound size={18} />
                    </span>
                    <div className="self-member-copy">
                      <p className="self-member-name">{entry.fullName}</p>
                      <p className="self-member-meta">Member code {entry.memberCode}</p>
                      <p className="self-member-meta">
                        {entry.facilityName ?? "Facility not recorded"}
                      </p>
                    </div>
                    <StatusBadge
                      tone={MEMBER_STATUS_TONE[entry.status] ?? "neutral"}
                    >
                      {STATUS_LABEL[entry.status] ?? entry.status}
                    </StatusBadge>
                  </div>}
                  <div className={`self-actions${ownEntry ? " !mt-0" : ""}${pairedActions ? " self-actions-paired" : ownEntry ? " !grid" : ""}`}>
                    {scopeKind === "staff_session" ? (
                      <Link
                        aria-label={family ? `Sign in for ${entry.fullName}${duplicateNames.has(entry.fullName) ? `, member code ${entry.memberCode}` : ""}` : undefined}
                        href={`${homeBase}/sign-in?clubId=${encodeURIComponent(tenantId)}`}
                        className="self-action self-action-primary"
                      >
                        Sign in
                      </Link>
                    ) : (
                      <>
                        {!canOpenFees ? (
                          <div className="rounded-ctl border border-line bg-deck px-3 py-2">
                            <p className="text-[13px] leading-relaxed text-ink-2">
                              {canViewOwnBilling === false
                                ? "A linked guardian can view fees. Contact your club for help."
                                : "Fees are temporarily unavailable."}
                            </p>
                            {canViewOwnBilling === null ? (
                              <a href="/member" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent-ink underline underline-offset-2">Retry fees access</a>
                            ) : null}
                          </div>
                        ) : (
                          <Link
                            aria-label={family ? `Fees and payments for ${entry.fullName}${duplicateNames.has(entry.fullName) ? `, member code ${entry.memberCode}` : ""}` : undefined}
                            href={family ? `/family/billing/${entry.memberId}` : "/member/billing"}
                            className="self-action self-action-primary"
                          >
                            <ReceiptIndianRupee size={15} aria-hidden="true" />
                            Fees
                          </Link>
                        )}
                        <Link
                          aria-label={family ? `Achievements page for ${entry.fullName}${duplicateNames.has(entry.fullName) ? `, member code ${entry.memberCode}` : ""}` : "Your achievements page"}
                          href={family ? `/family/showcase/${entry.memberId}` : "/member/showcase"}
                          className="self-action self-action-quiet"
                        >
                          <Trophy size={15} aria-hidden="true" />
                          Achievements
                        </Link>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <OptionalWorkspaceGuide
          key={guideKey}
          startCollapsed
          preferenceKey={guideKey}
          items={guideItems}
          title={family ? "Explore your family view" : "Explore your member view"}
          regionLabel={family ? "Optional family guide" : "Optional member guide"}
          itemLabel="Page feature"
        />

        <footer className="self-footer">
          <div className="self-footer-links">
            <GuideHelpButton homeHref={homeBase} />
          </div>
          <p className="self-privacy">
            For membership or payment changes, contact your club.
          </p>
        </footer>
      </div>
    </main>
  );
}
