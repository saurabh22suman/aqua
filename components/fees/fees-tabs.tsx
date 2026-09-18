import Link from "next/link";

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
}: {
  active: FeesTab;
  period: { from: string; to: string };
}) {
  const query = `from=${period.from}&to=${period.to}`;
  return (
    <nav aria-label="Fees sections" className="flex flex-wrap gap-2">
      {FEES_TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/owner/fees?tab=${tab.key}&${query}`}
          aria-current={active === tab.key ? "page" : undefined}
          className={`rounded-pill border px-3.5 py-2 text-[13px] ${
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
