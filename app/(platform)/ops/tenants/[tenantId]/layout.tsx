import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getTenantHeader } from "@/db/platform-tenants";
import { asTenantId } from "@/lib/ids";
import { requireUuidParam } from "@/lib/params";
import { StatusBadge, TENANT_STATUS_TONE } from "@/components/ui/StatusBadge";
import { TenantTabNav } from "./tenant-tab-nav";

const STATUS_LABEL: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  suspended: "Suspended",
  churned: "Churned",
};

// PR4 (ops console improvements) — shared header + tab bar for every
// tenant-detail route. Each tab page still opens with its own auth
// check (matching the rest of /ops — see e.g. configuration/page.tsx)
// since this layout wrapping a page is not the same code path as
// calling that page's function directly (tests/mobile/invalid-id-pages.test.ts
// does the latter for the Overview tab), so the guard can't live only
// here.
export default async function TenantDetailLayout({
  params,
  children,
}: {
  params: Promise<{ tenantId: string }>;
  children: ReactNode;
}) {
  const auth = await platformAuthStatusAction();
  if (auth.kind !== "authenticated") redirect("/ops/login");

  const { tenantId } = await params;
  requireUuidParam(tenantId);
  const header = await getTenantHeader(asTenantId(tenantId));
  if (!header) notFound();

  return (
    <div className="max-w-5xl">
      <Link
        href="/ops/tenants"
        className="text-[13px] text-ink-3 hover:text-ink underline-offset-2 hover:underline"
      >
        ← All tenants
      </Link>

      <div className="mt-3 flex items-baseline gap-4">
        <h1 className="font-display text-[28px] font-semibold text-marine">
          {header.name}
        </h1>
        <StatusBadge tone={TENANT_STATUS_TONE[header.status] ?? "neutral"}>
          {STATUS_LABEL[header.status] ?? header.status}
        </StatusBadge>
      </div>
      <p className="mt-1 font-mono text-[13px] text-ink-3">{header.slug}</p>

      <TenantTabNav tenantId={header.id} />

      <div className="mt-6">{children}</div>
    </div>
  );
}
