import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getActivePreset } from "@/db/platform-presets";
import { presetOfferedForKind, previewPreset } from "@/db/preset-engine";
import { listLocationsForOps, listTenants } from "@/db/platform-tenants";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { PresetDetailForm, type LocationOption } from "./preset-detail-form";
import {
  OpsPage,
  OpsPageHeader,
  OpsPanel,
  OpsSection,
} from "@/components/ops/ops-primitives";
import { OpsReadOnlyNote } from "@/components/ops/ops-display";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

// Phase 2.2b — per-preset detail page at /ops/presets/[key].
// The catalogue page links here for the dominant "Open preview"
// action; this page renders the full preview breakdown and the
// apply form.
//
// Composition reminder: per design, one dominant element on a
// screen. The Apply button is the only saturated colour on this
// page; the preview breakdown and the tenant picker are secondary.
//
// Ops redesign (28 October 2026): the write permission is resolved on
// the server from the session role — a viewer reads the preview and is
// told why it cannot be applied.

type PreviewCounts = {
  featuresEnabled: number;
  programs: number;
  skillLevels: number;
  skills: number;
  planShapes: number;
  facilities: number;
  facilitySubUnits: number;
  exampleBatches: number;
  messageTemplates: number;
  dashboardCards: number;
  roles: number;
};

const previewRows = (counts: PreviewCounts) => [
  { key: "featuresEnabled", value: counts.featuresEnabled, label: "features enabled" },
  { key: "programs", value: counts.programs, label: "programs" },
  { key: "skillLevels", value: counts.skillLevels, label: "skill levels" },
  { key: "skills", value: counts.skills, label: "skills" },
  { key: "planShapes", value: counts.planShapes, label: "plan shapes" },
  { key: "facilities", value: counts.facilities, label: "facilities" },
  { key: "facilitySubUnits", value: counts.facilitySubUnits, label: "facility sub-units" },
  { key: "exampleBatches", value: counts.exampleBatches, label: "example batches" },
  { key: "messageTemplates", value: counts.messageTemplates, label: "message templates" },
  { key: "dashboardCards", value: counts.dashboardCards, label: "dashboard cards" },
  { key: "roles", value: counts.roles, label: "vertical roles" },
];

export default async function PresetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams?: Promise<{ search?: string; page?: string }>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");
  const canWrite = status.role === "admin";

  const { key } = await params;
  const result = await runOpsGlobalRead(
    "preset.detail",
    () => getActivePreset(key),
    "ops_page",
  );
  if (!result || result.kind === "not_found") notFound();

  const preview = await runOpsGlobalRead(
    "preset.preview",
    () => previewPreset(key),
    "ops_page",
  );
  if (!preview || preview.kind === "not_found") notFound();

  // Tenant list for the picker. The listTenants function is the
  // canonical operator-facing list (with status pill and member
  // count); it powers /ops/tenants too. limit=200 covers the
  // early adopter case (a handful of tenants per operator); if a
  // future operator has more, the search filter narrows the
  // picker. The picker's data shape only needs id, name, slug,
  // presetKey, and memberCount for display — the engine's
  // applyPreset will check the lock on submit, so the picker
  // does not pre-validate per-tenant.
  const query = (await searchParams) ?? {};
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 120).trimEnd() || undefined : undefined;
  const page = Math.max(1, Math.min(100000, parseInt(query.page ?? "1", 10) || 1));
  const tenantsResult = await runOpsGlobalRead(
    "tenant.list",
    () => listTenants({ limit: 200, offset: (page - 1) * 200, search }),
    "ops_page",
  );
  if (!tenantsResult) redirect("/ops/login");
  const tenants = tenantsResult.rows;
  const totalPages = Math.max(1, Math.ceil(tenantsResult.total / 200));
  const href = (target: number) => `?${new URLSearchParams({ ...(search ? { search } : {}), page: String(target) }).toString()}`;
  if (page > totalPages) redirect(href(totalPages));

  // O-03 — the picker chooses a location, not just a tenant. One
  // query for every live location; `eligible` is computed here so
  // the client island never imports the engine's server module.
  const allLocations = await runOpsGlobalRead(
    "location.list",
    () => listLocationsForOps(),
    "ops_page",
  );
  if (!allLocations) redirect("/ops/login");
  const locationsByTenant: Record<string, LocationOption[]> = {};
  for (const l of allLocations) {
    const options = locationsByTenant[l.tenantId] ?? [];
    options.push({
      id: l.id,
      name: l.name,
      kind: l.kind,
      isPrimary: l.isPrimary,
      presetKey: l.presetKey,
      presetVersion: l.presetVersion,
      eligible: presetOfferedForKind(result.key, l.kind),
    });
    locationsByTenant[l.tenantId] = options;
  }

  return (
    <OpsPage className="max-w-[820px]">
      <OpsPageHeader
        eyebrow={`Catalogue / ${result.key}`}
        title={result.name}
        lede={result.description}
      />

      <OpsSection className="mt-6" title="What gets seeded">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {previewRows(preview.preview.counts).map((row) => (
            <li key={row.key} className="rounded-ctl bg-deck px-3 py-2 text-[12px]">
              <span className="font-mono font-semibold text-ink">{row.value}</span>
              <span className="ml-1.5 text-ink-3">{row.label}</span>
            </li>
          ))}
        </ul>
      </OpsSection>

      {canWrite ? (
        <>
        <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
          <label>Search business accounts<Input name="search" type="search" maxLength={120} defaultValue={search ?? ""} /></label>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <p className="mt-2 text-[12px] text-ink-3">Page {page} of {totalPages} · {tenantsResult.total} matching accounts</p>
        <div className="flex gap-4 text-[13px]">
          {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : null}
          {page < totalPages ? <Link href={href(page + 1)}>Next</Link> : null}
        </div>
        <PresetDetailForm
          presetKey={result.key}
          presetName={result.name}
          tenants={tenants}
          hasSearch={Boolean(search)}
          locationsByTenant={locationsByTenant}
        />
        </>
      ) : (
        <>
          <OpsSection className="mt-8" title="Apply to a location">
            <OpsReadOnlyNote>
              Read-only: this account can browse, not change, platform data. An
              administrator applies a preset to a location.
            </OpsReadOnlyNote>
          </OpsSection>
          <OpsPanel tone="warn" className="mt-4" title="Applying writes tenant-wide settings too">
            Terminology, roles and skills apply to the whole tenant even when
            one location is selected. Applying is idempotent.
          </OpsPanel>
        </>
      )}
    </OpsPage>
  );
}
