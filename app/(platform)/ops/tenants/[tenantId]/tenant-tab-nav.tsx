"use client";

import { OpsTabs } from "@/components/ops/ops-tabs";

// PR4 (ops console improvements) — every existing panel on tenant
// detail grouped into tabs (Overview / Configuration / Entitlements /
// Locations / Messaging / Audit) instead of one long scroll. Each tab
// is a real route (not client-side state), so a link to a specific
// tab is shareable and the back button works as expected.
//
// Ops redesign (28 October 2026): the bar is the shared Ops tab bar
// (components/ops/ops-tabs.tsx), and it carries the GST destination
// as well. The GST page already existed and already worked, but it was
// reachable only from a sentence link inside the Configuration page —
// a screen an operator could easily miss. A tax rate is a
// configuration setting, so it sits next to Configuration; every other
// destination keeps its place.
//
// The current tab is resolved from the URL inside the shared bar, so
// the tab bar and the navigation rail can never disagree.
export function TenantTabNav({ tenantId }: { tenantId: string }) {
  const base = `/ops/tenants/${tenantId}`;
  return (
    <OpsTabs
      label="Tenant"
      tabs={[
        { href: base, label: "Overview" },
        { href: `${base}/configuration`, label: "Configuration" },
        { href: `${base}/tax`, label: "GST" },
        { href: `${base}/entitlements`, label: "Entitlements" },
        { href: `${base}/locations`, label: "Locations" },
        { href: `${base}/messaging`, label: "Messaging" },
        { href: `${base}/audit`, label: "Audit" },
      ]}
    />
  );
}
