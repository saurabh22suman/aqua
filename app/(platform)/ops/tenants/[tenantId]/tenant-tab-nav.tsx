"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

const tenantSections = [
  { label: "Workspace", links: [{ path: "", label: "Overview" }] },
  { label: "Setup", links: [
    { path: "/configuration", label: "Configuration" },
    { path: "/tax", label: "GST" },
    { path: "/entitlements", label: "Entitlements" },
    { path: "/locations", label: "Locations" },
  ] },
  { label: "Investigation", links: [
    { path: "/messaging", label: "Messaging" },
    { path: "/audit", label: "Audit" },
    { path: "/diagnostics", label: "Diagnostics", adminOnly: true },
  ] },
] as const;

export function TenantTabNav({
  tenantId,
  canViewDiagnostics,
}: {
  tenantId: string;
  canViewDiagnostics: boolean;
}) {
  const pathname = usePathname();
  const base = `/ops/tenants/${tenantId}`;

  return (
    <nav aria-label="Tenant" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-b border-line">
      {tenantSections.map(({ label, links }) => (
        <div key={label} role="group" aria-label={label} className="min-w-0">
          <p aria-hidden="true" className="px-2 text-xs font-medium text-ink-3">{label}</p>
          <div className="flex flex-wrap gap-x-1">
            {links.filter((link) => !("adminOnly" in link) || canViewDiagnostics).map(({ path, label }) => {
              const href = base + path;
              const current = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-t-md border-b-2 px-2 text-[13px] font-medium transition-colors hover:bg-deck hover:text-ink focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]",
                    current
                      ? "border-[var(--accent-strong)] bg-paper text-[var(--accent-ink)]"
                      : "border-transparent text-ink-2",
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
