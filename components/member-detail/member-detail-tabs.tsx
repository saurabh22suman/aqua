import Link from "next/link";

// U-03 — the member 360 tabs. Payments / Progress / Notes / Documents
// are real tabs. Progress was deliberately absent while M-03/V-10 were
// other workstreams; V-11 wires it to the generic framework's
// assessments.
//
// Plain links with `?tab=`, so every tab is a server render.

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
}: {
  memberId: string;
  active: MemberTab;
}) {
  return (
    <nav aria-label="Member sections" className="mt-4 flex flex-wrap gap-2">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/owner/members/${memberId}?tab=${tab.key}`}
          aria-current={active === tab.key ? "page" : undefined}
          className={`flex min-h-[44px] items-center rounded-pill border px-3.5 text-[13px] ${
            active === tab.key
              ? "border-ink bg-ink text-paper"
              : "border-line bg-paper text-ink-2"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
