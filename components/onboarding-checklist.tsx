import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClasses } from "@/components/ui/Button";
import type { OnboardingChecklist } from "@/lib/services/onboarding-checklist";

// Phase 2.8 — onboarding checklist surface.
//
// Owner OpenPen (29 October 2026): completion is a small evidence
// surface, not a hero. The three existing checks stay one clear next
// task at a time; the count is the surface title, each row states its
// own condition and only the next incomplete step carries a primary
// action. Completion means these register checks passed, not that the
// whole academy is ready.

export function OnboardingChecklistView({ data }: { data: OnboardingChecklist }) {
  const nextIncomplete = data.items.find((it) => !it.complete);
  const allDone = nextIncomplete === undefined;
  const nextIndex = data.items.findIndex((it) => !it.complete);

  return (
    <OwnerPage>
      <PageHeader
        title="Set up your first register"
        purpose="Three existing checks; one clear next task."
      />

      <section
        className="mt-5 max-w-2xl rounded-card border border-line bg-paper"
        data-testid="onboarding-checks"
      >
        <div className="px-5 pt-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
            {allDone ? "Completed" : "What's left"}
          </p>
          <h2 className="mt-1 font-display text-[16px] font-semibold">
            {data.completedCount} of {data.totalCount} checks complete
          </h2>
        </div>

        <ol className="mt-3 divide-y divide-line border-t border-line">
          {data.items.map((item, index) => {
            const isNext = !item.complete && index === nextIndex;
            return (
              <li key={item.key} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-deck text-ink-2"
                    aria-hidden="true"
                  >
                    {item.complete ? (
                      <Check size={15} strokeWidth={2.4} />
                    ) : (
                      <span className="text-[12px] font-semibold tabular-nums">
                        {index + 1}
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium leading-tight text-ink">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">
                      {item.detail}
                    </p>
                    {!item.complete && item.secondaryCta ? (
                      <Link
                        href={item.secondaryCta.href}
                        className="mt-1 inline-flex min-h-11 items-center text-[12.5px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
                      >
                        {item.secondaryCta.label}
                      </Link>
                    ) : null}
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    {item.complete ? (
                      <StatusBadge tone="good">Done</StatusBadge>
                    ) : isNext ? (
                      <Link
                        href={item.cta.href}
                        className={buttonClasses({ variant: "primary", size: "sm" })}
                      >
                        {item.cta.label}
                        <ChevronRight size={14} aria-hidden="true" />
                      </Link>
                    ) : (
                      <span className="text-[12px] text-ink-3">Next step</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="border-t border-line px-5 py-3">
          <Link
            href="/owner"
            className="inline-flex min-h-11 items-center text-[13px] font-medium text-ink-2 underline underline-offset-2"
          >
            Go to owner home
          </Link>
        </div>
      </section>
    </OwnerPage>
  );
}
