import { env } from "@/lib/env";
import { DemoBannerStrip } from "./demo-banner-strip";

// Demo-mode banner. Renders only when DEMO_MODE is on (and renders
// nothing otherwise). The banner is the only place in the runtime
// that reads DEMO_MODE besides lib/env.ts itself and the demo reset
// scripts — the source-scan in tests/tier1/demo-mode-reads.test.ts
// enforces this confinement.
//
// Neutral ink treatment: bg-marine + text-paper, never warn (which
// means "needs attention" in DESIGN.md) or late (which means
// "overdue / absent"). marine/paper are non-semantic surface tokens
// (DESIGN.md §1.1) — high-contrast, but not a claim about money or
// attendance state. Previously bg-deck + text-ink-2, which is the
// same color as the page background it sits on (DESIGN.md's `deck`
// token is literally "page background"): the banner was technically
// non-semantic but effectively invisible. The point is unmistakable
// clarity to a real club owner looking at synthetic data, not an
// alarm — but "unmissable" is part of that, not optional.
//
// F-7: the visual variant (tenant vs platform) lives in the client
// strip; this gate stays a server component so DEMO_MODE is never
// read in the browser bundle.
const TENANT_COPY =
  "Demo data — this is a demo tenant. None of this is real academy data.";
const PLATFORM_COPY =
  "Demo mode — this control plane manages demo tenants only. None of this is real customer data.";

export function DemoBanner() {
  if (!env.DEMO_MODE) return null;
  return <DemoBannerStrip tenantCopy={TENANT_COPY} platformCopy={PLATFORM_COPY} />;
}
