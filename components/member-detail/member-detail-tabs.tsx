import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { OwnerLink } from "@/components/owner-ui/owner-link";

// U-03 — the member 360 tabs. Documents remains available for old links,
// but is not promoted as a peer while document uploads are unavailable.
// Progress was deliberately absent while M-03/V-10 were
// other workstreams; V-11 wires it to the generic framework's
// assessments.
//
// Plain links with `?tab=`, so every tab is a server render.
//
// Owner redesign (C2) — the member tabs now use the same shared
// segmented tab bar as the Fees hub, so one owner surface has one tab
// shape and one active state.

export type MemberTab =
  | "overview"
  | "payments"
  | "progress"
  | "notes"
  | "documents";

const TABS: Array<{ key: MemberTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "payments", label: "Payments" },
  { key: "progress", label: "Progress" },
  { key: "notes", label: "Notes" },
  { key: "documents", label: "Documents" },
];

export function MemberDetailTabs({
  memberId,
  active,
  facilityScope,
}: {
  memberId: string;
  active: MemberTab;
  // The scope the member was opened under — the canonical facility or an
  // explicit "all". It travels with every tab so the drill-down never
  // lands on a URL without the query, which the facility switcher would
  // normalise with a hard reload. Optional: a consumer without a scope
  // keeps its own plain links.
  facilityScope?: string;
}) {
  const scope = facilityScope ? `&facility=${facilityScope}` : "";
  return (
    <div className="mt-4">
      <SegmentedTabs
        ariaLabel="Member sections"
        active={active}
        tabs={TABS.filter((tab) => tab.key !== "documents" || active === "documents").map((tab) => ({
          key: tab.key,
          label: tab.label,
          href: `/owner/members/${memberId}?tab=${tab.key}${scope}`,
        }))}
      />
      {active !== "documents" ? (
        <OwnerLink href={`/owner/members/${memberId}?tab=documents${scope}`} className="mt-2 inline-flex min-h-11 items-center text-[12px] text-ink-3 underline underline-offset-2">
          Documents
        </OwnerLink>
      ) : null}
    </div>
  );
}
