import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { getActivePreset } from "@/db/platform-presets";
import { previewPreset } from "@/db/preset-engine";
import { listTenants } from "@/db/platform-tenants";
import { PresetDetailForm } from "./preset-detail-form";

// Phase 2.2b — per-preset detail page at /platform/presets/[key].
// The catalogue page links here for the dominant "Open preview"
// action; this page renders the full preview breakdown and the
// apply form.
//
// Composition reminder: per design, one dominant element on a
// screen. The Apply button is the only saturated colour on this
// page; the preview breakdown and the tenant picker are secondary.

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
}: {
  params: Promise<{ key: string }>;
}) {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/platform/login");

  const { key } = await params;
  const result = await getActivePreset(key);
  if (result.kind === "not_found") notFound();

  const preview = await previewPreset(key);
  if (preview.kind === "not_found") notFound();

  // Tenant list for the picker. The listTenants function is the
  // canonical operator-facing list (with status pill and member
  // count); it powers /platform/tenants too. limit=200 covers the
  // early adopter case (a handful of tenants per operator); if a
  // future operator has more, the search filter narrows the
  // picker. The picker's data shape only needs id, name, slug,
  // presetKey, and memberCount for display — the engine's
  // applyPreset will check the lock on submit, so the picker
  // does not pre-validate per-tenant.
  const tenantsResult = await listTenants({ limit: 200, offset: 0 });
  const tenants = tenantsResult.rows;

  return (
    <div className="max-w-3xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/platform/presets"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Catalogue
        </Link>
        {" / "}
        {result.key}
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        {result.name}
      </h1>
      <p className="mt-1 text-[14px] text-ink-2">{result.description}</p>

      <section className="mt-6">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          What gets seeded
        </h2>
        <ul className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {previewRows(preview.preview.counts).map((row) => (
            <li
              key={row.key}
              className="rounded-ctl bg-deck px-3 py-2 text-[12px]"
            >
              <span className="font-mono text-ink font-semibold">
                {row.value}
              </span>
              <span className="ml-1.5 text-ink-3">{row.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <PresetDetailForm
        presetKey={result.key}
        presetName={result.name}
        tenants={tenants}
      />
    </div>
  );
}
