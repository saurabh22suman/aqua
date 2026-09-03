import { FlaskConical } from "lucide-react";
import { env } from "@/lib/env";

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
export function DemoBanner() {
  if (!env.DEMO_MODE) return null;
  return (
    <div
      className="sticky top-0 z-40 bg-marine text-paper"
      data-testid="demo-banner"
    >
      <div className="max-w-screen-md mx-auto px-5 py-2 flex items-center justify-center gap-2 text-[12.5px] font-medium">
        <FlaskConical size={13} className="text-paper/70 flex-none" aria-hidden />
        <span>
          Demo data — this is a demo tenant. None of this is real academy data.
        </span>
      </div>
    </div>
  );
}