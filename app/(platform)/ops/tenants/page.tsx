import Link from "next/link";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listTenants, listAllPlansForFilter } from "@/db/platform-tenants";
import { listPresets } from "@/db/platform-presets";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  OpsEmptyState,
  OpsPage,
  OpsPageHeader,
  OpsTextLink,
} from "@/components/ops/ops-primitives";
import { OpsToolbar } from "@/components/ops/ops-table";
import { TenantCards, TenantTable } from "./tenant-table";

// PR2 (ops tenant health) — db/tenant-health.ts computes the status;
// this is only the display mapping. `null` (churned tenants — not
// scored) renders as a dash, not a pill, per the same "don't imply
// there's a value when there isn't one" rule the rest of this page
// already follows for planName.
//
// Ops redesign (28 October 2026): the page is the shared Ops frame, and
// every control in the filter toolbar is the SHARED control — the same
// Input, Select and Button the tenant workspace uses, so the console's
// filters carry the approved 48px height, 10px radius, 16px control
// text and the neutral-entry / tinted-picker surfaces without a second
// style system of the Ops console's own.
//
// The toolbar is a real GET form, so the filter state IS the URL: the
// operator can copy it, and Back returns to the previous filter set.
//
// Each filter keeps its own wrapping <label>, so the control is
// associated with its name by the label element itself (the label text
// is the control's accessible name, not a placeholder).

const PAGE_SIZE = 20;

type SearchParams = {
  search?: string;
  status?: string;
  planId?: string;
  presetKey?: string;
  health?: string;
  trial?: string;
  page?: string;
};

const HEALTH_FILTER_VALUES = ["healthy", "attention", "at_risk"] as const;
const TRIAL_FILTER_VALUES = ["expiring_soon", "expired"] as const;

// Preserves every current filter while changing just `page` — so
// paging never silently drops the filters the operator set.
function pageHref(params: SearchParams, page: number): string {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.planId) qs.set("planId", params.planId);
  if (params.presetKey) qs.set("presetKey", params.presetKey);
  if (params.health) qs.set("health", params.health);
  if (params.trial) qs.set("trial", params.trial);
  if (page > 1) qs.set("page", String(page));
  const query = qs.toString();
  return query ? `/ops/tenants?${query}` : "/ops/tenants";
}

export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const health = HEALTH_FILTER_VALUES.find((v) => v === params.health);
  const trial = TRIAL_FILTER_VALUES.find((v) => v === params.trial);

  const [result, plans, presetEntries] = await Promise.all([
    runOpsGlobalRead(
      "tenant.list",
      () =>
        listTenants({
          search: params.search?.trim() || undefined,
          status:
            params.status === "trial" ||
            params.status === "active" ||
            params.status === "suspended" ||
            params.status === "churned"
              ? params.status
              : undefined,
          planId: params.planId || undefined,
          presetKey: params.presetKey || undefined,
          health,
          trial,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
      "ops_page",
    ),
    runOpsGlobalRead("plan.list", () => listAllPlansForFilter(), "ops_page"),
    runOpsGlobalRead("preset.list", () => listPresets(), "ops_page"),
  ]);
  if (!result || !plans || !presetEntries) redirect("/ops/login");

  // One row per preset key for the filter dropdown — listPresets()
  // returns one row per (key, version).
  const presets = Array.from(
    new Map(presetEntries.map((p) => [p.key, p])).values(),
  );

  const hasFilters =
    Boolean(params.search) ||
    Boolean(params.status) ||
    Boolean(params.planId) ||
    Boolean(params.presetKey) ||
    Boolean(health) ||
    Boolean(trial);

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const rangeStart = result.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, result.total);

  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Tenants"
        title="All tenants"
        lede={
          result.total === 0
            ? "0 tenants"
            : `Showing ${rangeStart}–${rangeEnd} of ${result.total} ${result.total === 1 ? "tenant" : "tenants"}`
        }
        actions={
          <Link
            href="/ops/tenants/new"
            className={buttonClasses({ variant: "primary" })}
          >
            New tenant
          </Link>
        }
      />

      <OpsToolbar
        className="mt-6"
        actions={
          <>
            <Button type="submit" variant="primary">
              Apply
            </Button>
            {hasFilters ? (
              <Link
                href="/ops/tenants"
                className={buttonClasses({ variant: "secondary" })}
              >
                Clear
              </Link>
            ) : null}
          </>
        }
      >
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Search</span>
          <Input
            type="search"
            name="search"
            defaultValue={params.search ?? ""}
            placeholder="name or slug"
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Status</span>
          <Select name="status" defaultValue={params.status ?? ""}>
            <option value="">All</option>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="churned">Churned</option>
          </Select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Plan</span>
          <Select name="planId" defaultValue={params.planId ?? ""}>
            <option value="">All</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Preset</span>
          <Select name="presetKey" defaultValue={params.presetKey ?? ""}>
            <option value="">All</option>
            {presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Health</span>
          <Select name="health" defaultValue={params.health ?? ""}>
            <option value="">All</option>
            <option value="healthy">Healthy</option>
            <option value="attention">Attention</option>
            <option value="at_risk">At risk</option>
          </Select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Trial</span>
          <Select name="trial" defaultValue={params.trial ?? ""}>
            <option value="">All</option>
            <option value="expiring_soon">Expiring soon</option>
            <option value="expired">Expired</option>
          </Select>
        </label>
      </OpsToolbar>

      {result.rows.length === 0 ? (
        <OpsEmptyState
          className="mt-8"
          title={hasFilters ? "No tenants match these filters." : "No tenants yet."}
          body={
            hasFilters ? (
              <>
                Try clearing the filter, or{" "}
                <OpsTextLink href="/ops/tenants/new">add a tenant</OpsTextLink>.
              </>
            ) : (
              <>
                Create the first tenant from the control plane.{" "}
                <OpsTextLink href="/ops/tenants/new">Add a tenant</OpsTextLink>.
              </>
            )
          }
        />
      ) : (
        <>
          <TenantCards rows={result.rows} />
          <TenantTable rows={result.rows} />

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[12px] text-ink-3">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link
                    href={pageHref(params, page - 1)}
                    className={buttonClasses({ variant: "secondary", size: "sm" })}
                  >
                    Previous
                  </Link>
                ) : (
                  <span
                    className={`${buttonClasses({ variant: "secondary", size: "sm" })} pointer-events-none border-line text-ink-3/50`}
                  >
                    Previous
                  </span>
                )}
                {page < totalPages ? (
                  <Link
                    href={pageHref(params, page + 1)}
                    className={buttonClasses({ variant: "secondary", size: "sm" })}
                  >
                    Next
                  </Link>
                ) : (
                  <span
                    className={`${buttonClasses({ variant: "secondary", size: "sm" })} pointer-events-none border-line text-ink-3/50`}
                  >
                    Next
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </OpsPage>
  );
}
