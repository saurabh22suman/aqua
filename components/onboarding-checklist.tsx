import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import type { OnboardingChecklist } from "@/lib/services/onboarding-checklist";

// Phase 2.8 — onboarding checklist surface. One dominant element
// per screen, per DESIGN.md: the marine hero card carries the
// progress and a single primary action (the first incomplete item,
// which is also the implicit "what to do next"). The item list
// below carries state per item; each row is a full-width 44 px
// touch target linking to where the work is done.
//
// Composition intentionally matches the sports-club-ui-direction
// reference's "Owner · home" framing — same hero treatment, same
// row treatment for the list — so this screen reads as a kin
// surface rather than a new shape.

export function OnboardingChecklistView({ data }: { data: OnboardingChecklist }) {
  const nextIncomplete = data.items.find((it) => !it.complete);
  const allDone = nextIncomplete === undefined;

  return (
    <main className="px-5 pt-6 pb-8">
      <div className="flex items-center gap-3 pb-4">
        <div>
          <h1 className="font-display text-[19px] font-semibold leading-tight">
            Set up your academy
          </h1>
          <p className="text-[12.5px] text-ink-3 mt-0.5">
            {allDone
              ? "Everything below is in place."
              : "A few quick steps and the register is ready to go."}
          </p>
        </div>
      </div>

      {/* Hero — one dominant element. Marine card with a single big
          figure and a single primary CTA (the next incomplete item),
          matching the owner dashboard's hero treatment. */}
      <div className="rounded-card bg-marine px-5 py-5 text-paper">
        {allDone ? (
          <>
            <p className="text-[12.5px] font-medium text-paper/70">Setup</p>
            <p className="mt-1.5 font-display text-[32px] font-semibold tracking-tight leading-none">
              All set
            </p>
            <p className="mt-2 text-[13px] text-paper/80">
              Every onboarding step is complete. Add more members or batches whenever you&apos;re ready.
            </p>
          </>
        ) : (
          <>
            <p className="text-[12.5px] font-medium text-paper/70">Setup progress</p>
            <p className="mt-1.5 font-display text-[38px] font-semibold tracking-tight leading-none">
              {data.completedCount}
              <span className="text-paper/60 font-normal">/{data.totalCount}</span>
            </p>
            <p className="mt-1.5 text-[13px] text-paper/80">
              {data.totalCount - data.completedCount === 1
                ? "One more thing to set up."
                : `${data.totalCount - data.completedCount} more to set up.`}
            </p>
            {/* Single primary CTA — the next incomplete item, so the
                dominant action always points at what's actually next. */}
            {nextIncomplete ? (
              <Link
                href={nextIncomplete.cta.href}
                className="mt-4 block w-full rounded-pill py-3 text-center text-[14.5px] font-semibold text-ink bg-paper transition-colors duration-150"
              >
                {nextIncomplete.cta.label} →
              </Link>
            ) : null}
          </>
        )}
      </div>

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">
        What&apos;s left
      </h2>
      <ul>
        {data.items.map((item) => {
          const rowInner = (
            <div className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3">
              <div
                className={`h-9 w-9 rounded-[11px] grid place-items-center flex-none ${
                  item.complete
                    ? "bg-deck text-ink-2"
                    : "bg-deck text-ink-3"
                }`}
                aria-hidden="true"
              >
                {item.complete ? (
                  <Check size={16} strokeWidth={2.4} />
                ) : (
                  <span className="font-display text-[14px] font-semibold">!</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium leading-tight">{item.title}</p>
                <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
                  {item.complete ? "Done" : item.detail}
                </p>
              </div>
              <div className="flex-none text-ink-3">
                {item.complete ? (
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-pill bg-deck text-ink-2">
                    Done
                  </span>
                ) : (
                  <ChevronRight size={18} />
                )}
              </div>
            </div>
          );
          return (
            <li key={item.key} className="mb-2">
              {item.complete ? (
                rowInner
              ) : (
                <Link href={item.cta.href} className="block">
                  {rowInner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
