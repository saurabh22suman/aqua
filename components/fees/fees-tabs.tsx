
// U-02 — the Fees hub tab bar. Tabs are plain links with `?tab=`, so
// the hub works with zero client JavaScript and each tab is its own
// server-rendered read.

export type FeesTab = "overview" | "transactions" | "dues" | "invoices" | "plans";

export const FEES_TABS: Array<{ key: FeesTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "transactions", label: "Transactions" },
  { key: "dues", label: "Dues" },
  { key: "invoices", label: "Invoices" },
  { key: "plans", label: "Plans" },
];

export function FeesTabs({
  active,
  period,
  facility,
  canManageSettings = false,
}: {
  active: FeesTab;
  period: { from: string; to: string };
  facility?: string;
  // The Plans tab leads to /owner/settings/plans, which is
  // settings.manage territory; without the grant it is not offered
  // (an accountant can reach the owner surface but must not be
  // routed to plan management).
  canManageSettings?: boolean;
}) {
  const query = `from=${period.from}&to=${period.to}${
    `&facility=${facility ?? "all"}`
  }`;
  return (
    <nav aria-label="Fees sections" className="flex overflow-x-auto border-b border-line [scrollbar-width:none]">
      {FEES_TABS.filter((tab) => tab.key !== "plans" || canManageSettings).map((tab) => (
        <a key={tab.key} href={`/owner/fees?tab=${tab.key}&${query}`} aria-current={tab.key === active ? "page" : undefined} className={`inline-flex min-h-11 flex-none items-center border-b-2 px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring)] ${tab.key === active ? "border-[var(--accent-strong)] text-ink" : "border-transparent text-ink-3"}`}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
