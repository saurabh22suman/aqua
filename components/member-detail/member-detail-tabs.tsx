import { TransientDisclosure } from "@/components/ui/TransientDisclosure";

export type MemberTab = "overview" | "payments" | "progress" | "notes" | "documents";

export function MemberDetailTabs({ memberId, active, facilityScope, accessHref, canReadInvoices = true, canReadProgress = true }: {
  memberId: string;
  active: MemberTab;
  facilityScope?: string;
  accessHref?: string;
  canReadInvoices?: boolean;
  canReadProgress?: boolean;
}) {
  const scope = facilityScope ? `&facility=${encodeURIComponent(facilityScope)}` : "";
  const href = (tab: MemberTab) => `/owner/members/${memberId}?tab=${tab}${scope}`;
  const moreActive = active === "notes" || active === "documents";
  const tabClass = "inline-flex min-h-11 items-center justify-center border-b-2 px-2 text-[13px] font-medium";
  return (
    <nav aria-label="Member sections" className="relative mt-4 flex border-b border-line">
      {([ ["overview", "Overview"], ...(canReadInvoices ? [["payments", "Fees"] as const] : []), ...(canReadProgress ? [["progress", "Progress"] as const] : []) ] as const).map(([key, label]) => (
        <a key={key} href={href(key)} aria-current={active === key ? "page" : undefined} className={`${tabClass} ${active === key ? "border-[var(--accent-strong)] text-ink" : "border-transparent text-ink-3"}`}>{label}</a>
      ))}
      <TransientDisclosure key={`${memberId}:${active}:${facilityScope ?? ""}`} className="group relative" trigger="More" triggerClassName={`${tabClass} cursor-pointer list-none ${moreActive ? "border-[var(--accent-strong)] text-ink" : "border-transparent text-ink-3"}`}>
        <div className="absolute right-0 z-20 min-w-52 rounded-card border border-line bg-paper p-2 shadow-lg">
          <a href={href("notes")} aria-current={active === "notes" ? "page" : undefined} className="flex min-h-11 items-center rounded-ctl px-3 text-[13px] text-ink">Notes</a>
          {accessHref ? <a href={accessHref} data-testid="member-access-entry" className="flex min-h-11 items-center rounded-ctl px-3 text-[13px] text-ink">Member and family access</a> : null}
        </div>
      </TransientDisclosure>
    </nav>
  );
}
