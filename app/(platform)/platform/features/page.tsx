import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listFeatures } from "@/db/platform-features";
import { FeatureCatalogue } from "./feature-catalogue";

// Phase 1.7 — feature catalogue screen. The platform sidebar has
// linked `/platform/features` since 1.2; this is the page that
// lives there. Server-rendered: auth-gated, fetches the catalogue,
// hands the snapshot to a small client island that handles per-
// row edit/save.

export default async function FeaturesPage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/platform/login");

  const features = await listFeatures();
  return (
    <div className="max-w-4xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Catalogue
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        Feature catalogue
      </h1>
      <p className="mt-1 text-[14px] text-ink-2">
        Every feature Aqua ships, grouped by category. The
        <span className="px-1.5 mx-1 rounded-pill bg-deck text-[12px] font-mono text-ink-2">key</span>
        is the immutable analytics key — renaming it would
        invalidate every per-tenant override (Phase 1.8) and every
        preset reference. Editable: name, category, status.
      </p>

      <FeatureCatalogue initial={features} />
    </div>
  );
}
