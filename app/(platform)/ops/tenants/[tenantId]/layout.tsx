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
//
// Ops redesign (28 October 2026): the header is the shared Ops frame —
// a back link, the tenant's name with its status pill, and the tab bar
// that carries every tenant destination (GST included).
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
    <div className="mx-auto w-full max-w-[1080px]">
      <Link
        href="/ops/tenants"
        className="inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-3 transition-colors duration-150 hover:text-ink"
      >
        ← All tenants
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[28px] font-semibold leading-tight text-marine">
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
