"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// PR4 (ops console improvements) — every existing panel on tenant
// detail grouped into tabs (Overview / Configuration / Entitlements /
// Locations / Messaging / Audit) instead of one long scroll. Each tab
// is a real route (not client-side state), so a link to a specific
// tab is shareable and the back button works as expected.

const TABS = [
  { href: "", label: "Overview" },
  { href: "/configuration", label: "Configuration" },
  { href: "/entitlements", label: "Entitlements" },
  { href: "/locations", label: "Locations" },
  { href: "/messaging", label: "Messaging" },
  { href: "/audit", label: "Audit" },
] as const;

export function TenantTabNav({ tenantId }: { tenantId: string }) {
  const pathname = usePathname();
  const base = `/ops/tenants/${tenantId}`;

  return (
    <nav aria-label="Tenant" className="mt-4 flex gap-1 border-b border-line overflow-x-auto">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 px-3 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors duration-150 ${
              active
                ? "border-[var(--accent)] text-ink"
                : "border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
