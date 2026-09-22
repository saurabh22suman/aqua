import { SegmentedTabs } from "@/components/ui/SegmentedTabs";

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
    <SegmentedTabs
      ariaLabel="Fees sections"
      active={active}
      tabs={FEES_TABS.map((tab) => ({
        key: tab.key,
        label: tab.label,
        href: `/owner/fees?tab=${tab.key}&${query}`,
      }))}
    />
  );
}
