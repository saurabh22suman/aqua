import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";

// Phase 1.2 ships the platform shell; the substantive operator
// surfaces (tenant list, tenant detail, create-tenant, status
// lifecycle, feature catalogue, feature toggles) come in 1.3–1.8 and
// each opens its own PR. This page is the landing screen operators
// see after a successful 2FA, and intentionally has nothing on it
// yet — better an empty authenticated shell than one pretending to
// have content. 1.3 lands behind the same auth gate, on the same
// (platform) layout.
export default async function PlatformHome() {
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") {
    redirect("/platform/login");
  }
  if (status.kind === "unauthenticated") redirect("/platform/verify");
  return (
    <div className="max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Overview
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        Aqua control plane
      </h1>
      <p className="mt-2 text-[15px] text-ink-2">
        Signed in as <span className="font-medium">{status.role}</span>.
        Tenant list, feature catalogue and feature toggles land in the
        next phase — this screen is intentionally empty until they do,
        rather than a placeholder that pretends to be a dashboard.
      </p>
    </div>
  );
}
