import Link from "next/link";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listTenants } from "@/db/platform-tenants";

const STATUS_LABEL: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  suspended: "Suspended",
  churned: "Churned",
};

// Map tenant status to a visual token. Following DESIGN.md §1.1:
// semantic colours are reserved for money/attendance state; status
// here is operational, so we use the neutral palette plus the
// status pill pattern (coloured soft background + word). Suspended
// reads as a problem (late-soft + 'late' text); the others use ink-3
// on deck to keep the table visually quiet. Trial gets warn-soft + warn
// so it doesn't blend into active.

// Status pills — accessible word+colour per DESIGN.md §3. Every
// status carries a word even if the colour is identical to its
// neighbours; otherwise a colourblind reader can't tell 'trial' from
// 'active'. None of the four statuses are money/attendance state —
// warn/late/water are reserved for that — so the pills stay on the
// neutral ink palette. The label is the source of truth.
function StatusPill({ status }: { status: string }) {
  if (status === "suspended") {
    return (
      <span className="text-[11px] font-medium px-3 py-1 rounded-pill bg-ink-2/15 text-ink-2">
        {STATUS_LABEL[status]}
      </span>
    );
  }
  if (status === "trial") {
    return (
      <span className="text-[11px] font-medium px-3 py-1 rounded-pill bg-deck text-ink">
        {STATUS_LABEL[status]}
      </span>
    );
  }
  return (
    <span className="text-[11px] font-medium px-3 py-1 rounded-pill bg-deck text-ink-2">
      {STATUS_LABEL[status]}
    </span>
  );
}

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

type SearchParams = { search?: string; status?: string };

export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/platform/login");

  const params = await searchParams;
  const result = await listTenants({
    search: params.search?.trim() || undefined,
    status:
      params.status === "trial" ||
      params.status === "active" ||
      params.status === "suspended" ||
      params.status === "churned"
        ? params.status
        : undefined,
    limit: 100,
    offset: 0,
  });

  const hasFilters = Boolean(params.search) || Boolean(params.status);

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
            Tenants
          </p>
          <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
            All tenants
          </h1>
          <p className="mt-1 text-[14px] text-ink-2">
            {result.total} {result.total === 1 ? "tenant" : "tenants"}
            {hasFilters ? " matching the current filter" : ""}
          </p>
        </div>
        <Link
          href="/platform/tenants/new"
          className="rounded-pill py-2.5 px-5 text-[14px] font-semibold text-white bg-[var(--accent)] transition-colors duration-150"
        >
          New tenant
        </Link>
      </div>

      <form className="mt-6 flex items-end gap-3" method="get">
        <label className="flex-1 block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Search
          </span>
          <input
            type="search"
            name="search"
            defaultValue={params.search ?? ""}
            placeholder="name or slug"
            className="w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink placeholder:text-ink-3 focus:border-[var(--accent)] focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Status
          </span>
          <select
            name="status"
            defaultValue={params.status ?? ""}
            className="rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">All</option>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="churned">Churned</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-pill px-4 py-2 text-[13px] font-medium text-paper bg-marine hover:opacity-90 transition-colors duration-150"
        >
          Apply
        </button>
        {hasFilters ? (
          <Link
            href="/platform/tenants"
            className="rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 hover:text-ink hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {result.rows.length === 0 ? (
        <div className="mt-10 text-center py-12 rounded-card bg-paper border border-line">
          <p className="text-[15px] font-medium text-ink">
            {hasFilters ? "No tenants match these filters." : "No tenants yet."}
          </p>
          <p className="mt-2 text-[13px] text-ink-3">
            {hasFilters
              ? "Try clearing the filter, or "
              : "Create the first tenant from the control plane. "}
            <Link
              href="/platform/tenants/new"
              className="text-[var(--accent)] underline underline-offset-2"
            >
              add a tenant
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="mt-6 rounded-card bg-paper border border-line overflow-hidden">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.10em] text-ink-3 border-b border-line">
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Members</th>
                <th className="px-4 py-3 font-medium text-right">Locations</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-line last:border-b-0 hover:bg-deck/40 transition-colors duration-150"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/platform/tenants/${row.id}`}
                      className="font-medium text-ink hover:underline underline-offset-2"
                    >
                      {row.name}
                    </Link>
                    <p className="mt-0.5 text-[12px] text-ink-3 font-mono">
                      {row.slug}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.memberCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.locationCount}
                  </td>
                  <td className="px-4 py-3 text-ink-2">{row.planName ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-2">
                    {DATE_FMT.format(row.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
