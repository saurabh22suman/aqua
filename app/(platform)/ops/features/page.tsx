import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listFeatures } from "@/db/platform-features";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { withoutTestArtifactFeatureKeys } from "@/lib/feature-artifacts";
import { FeatureCatalogue } from "./feature-catalogue";
import { OpsPage, OpsPageHeader } from "@/components/ops/ops-primitives";
import { OpsReadOnlyNote } from "@/components/ops/ops-display";

// Phase 1.7 — feature catalogue screen. The platform sidebar has
// linked `/ops/features` since 1.2; this is the page that
// lives there. Server-rendered: auth-gated, fetches the catalogue,
// hands the snapshot to a small client island that handles per-
// row edit/save.
//
// Ops redesign (28 October 2026): the write permission is resolved on
// the server from the session role, so a viewer reads the catalogue
// and is told why it cannot be changed.
export default async function FeaturesPage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");
  const canWrite = status.role === "admin";

  // X-D4 (2026-09-13 audit, see lib/feature-artifacts.ts) — filter the
  // test-fixture rows before they cross the RSC boundary, so neither
  // the UI nor the serialized payload carries them.
  const catalogue = await runOpsGlobalRead(
    "feature.catalogue.list",
    () => listFeatures(),
    "ops_page",
  );
  if (!catalogue) redirect("/ops/login");
  const features = withoutTestArtifactFeatureKeys(catalogue);
  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Catalogue"
        title="Feature catalogue"
        lede={
          <>
            Every feature Aqua ships, grouped by category. The{" "}
            <span className="rounded-pill bg-deck px-2 py-0.5 font-mono text-[12px] text-ink-2">
              key
            </span>{" "}
            is the immutable analytics key — renaming it would invalidate
            every per-tenant override and every preset reference. Editable:
            name, category, status.
          </>
        }
      />
      {!canWrite ? (
        <OpsReadOnlyNote className="mt-5">
          Read-only: this account can browse, not change, platform data. The
          feature catalogue is edited by an administrator.
        </OpsReadOnlyNote>
      ) : null}
      <FeatureCatalogue initial={features} canWrite={canWrite} />
    </OpsPage>
  );
}
