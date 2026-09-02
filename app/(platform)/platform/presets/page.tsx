import Link from "next/link";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listPresets } from "@/db/platform-presets";
import { previewPreset } from "@/db/preset-engine";
import { PresetCatalogue } from "./preset-catalogue";

// Phase 2.2b — operator-facing preset catalogue at /platform/presets.
//
// Renders one card per active preset (today: swimming + multi-sport,
// seeded by 2.1). Each card surfaces the *preview* counts (programs,
// skill levels, plan shapes, facilities, example batches, message
// templates, dashboard cards) — drawn from `previewPreset`, the
// engine's pure function. Per the user's reminder: "the preview
// pane must show what WILL be seeded, drawn from previewPreset —
// not a hand-written description of the preset. A description that
// drifts from the definition is worse than none." The hardcoded
// description on the row comes from the `presets` table (where the
// seed writes it) and is shown as supporting prose; the counts are
// the source of truth.
//
// Each card has one dominant element per the design system: the
// "Open preview" button. Secondary actions (the description link,
// the count list) are below the fold; the button is the only
// saturated colour. Tenants' nav links to this page from the
// platform sidebar in 2.2b's small nav edit.

export default async function PresetsPage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/platform/login");

  const presets = await listPresets();
  // Preview is per-preset. Run each in parallel so the page render
  // is one round-trip for the catalogue list.
  const previews = await Promise.all(
    presets.map(async (p) => {
      const result = await previewPreset(p.key);
      return { preset: p, result };
    }),
  );

  return (
    <div className="max-w-4xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Catalogue
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        Preset catalogue
      </h1>
      <p className="mt-1 text-[14px] text-ink-2">
        Onboarding presets. The <Link href="/platform/tenants" className="text-[var(--accent)] underline underline-offset-2">tenant list</Link>{" "}
        shows the applied state; this page is the picker and the
        preview.
      </p>

      <PresetCatalogue entries={previews} />
    </div>
  );
}
