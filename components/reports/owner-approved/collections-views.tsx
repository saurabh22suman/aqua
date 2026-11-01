import Link from "next/link";
import type { OwnerPeriodKey } from "@/lib/time/owner-period-model";

export function CollectionsViews({ view, facility, period }: { view: "daily" | "trends"; facility?: string; period?: OwnerPeriodKey }) {
  const query = new URLSearchParams({ view: "trends", period: period ?? "last7" });
  if (facility) query.set("facility", facility);
  const dailyQuery = `?${new URLSearchParams({ facility: facility ?? "all" })}`;
  const tabs = [{ key: "trends", label: "Trends", href: `/owner/reports/collections?${query}` }, { key: "daily", label: "Daily close", href: `/owner/reports/collections${dailyQuery}` }] as const;
  return <nav aria-label="Collections views" className="mt-4 flex gap-2">{tabs.map(tab => tab.key === view
    ? <span key={tab.key} aria-current="page" className="inline-flex min-h-11 items-center rounded-pill bg-deck px-4 text-sm font-medium text-ink">{tab.label}</span>
    : <Link key={tab.key} href={tab.href} className="inline-flex min-h-11 items-center rounded-pill px-4 text-sm text-ink-2">{tab.label}</Link>)}</nav>;
}
