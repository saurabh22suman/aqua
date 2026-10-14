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
    facility ? `&facility=${facility}` : ""
  }`;
  return (
    <SegmentedTabs
      ariaLabel="Fees sections"
      active={active}
      tabs={FEES_TABS.filter(
        (tab) => tab.key !== "plans" || canManageSettings,
      ).map((tab) => ({
        key: tab.key,
        label: tab.label,
        href: `/owner/fees?tab=${tab.key}&${query}`,
      }))}
    />
  );
}
