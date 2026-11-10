import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
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
//
// 3 November 2026: when every real check is complete the page title says
// so. The state is read from the items themselves (`nextIncomplete`),
// so no progress figure is faked and no stored state is mutated.

export function OnboardingChecklistView({ data }: { data: OnboardingChecklist }) {
  const nextIncomplete = data.items.find((it) => !it.complete);
  const unavailable = data.items.length === 0;
  const allDone = !unavailable && nextIncomplete === undefined;
  const hasAllChecks = data.items.length === 3 && ["add_members", "create_batch", "assign_coach"].every((key) => data.items.some((item) => item.key === key));
  const limited = data.scopeIsLimited === true || data.totalCount !== 3 || !hasAllChecks;
  const nextIndex = data.items.findIndex((it) => !it.complete && Boolean(it.cta));

  return (
    <OwnerPage>
      <PageHeader
        title={unavailable ? "Register checks unavailable" : allDone ? limited ? "Available register checks complete" : "Register setup complete" : "Set up your first register"}
      />

      {allDone && limited && data.scopeIsLimited && (
        <p className="mt-3 max-w-2xl text-sm text-ink-2">This reflects the facilities visible to you.</p>
      )}
      {unavailable ? (
        <p className="mt-4 max-w-2xl text-sm text-ink-2">Register checks are unavailable with your current access.</p>
      ) : (
        <OptionalWorkspaceGuide items={data.items.map(({ key, title, detail, complete }) => ({ key, title, detail, complete }))} />
      )}

      {!unavailable && <section
        className="mt-5 max-w-2xl rounded-card border border-line bg-paper"
        data-testid="onboarding-checks"
      >
        <div className="px-4 pt-4 sm:px-5 sm:pt-5">
          {allDone ? null : (
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
              What&apos;s left
            </p>
          )}
          <h2
            className={
              allDone
                ? "font-display text-[16px] font-semibold"
                : "mt-1 font-display text-[16px] font-semibold"
            }
          >
            {data.completedCount} of {data.totalCount} checks complete
          </h2>
        </div>

        <ol className="mt-3 divide-y divide-line border-t border-line">
          {data.items.map((item, index) => {
            const isNext = !item.complete && index === nextIndex;
            return (
              <li key={item.key} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2.5">
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
                    ) : isNext && item.cta ? (
                      <Link
                        href={item.cta.href}
                        className={buttonClasses({ variant: "primary", size: "sm" })}
                      >
                        {item.cta.label}
                        <ChevronRight size={14} aria-hidden="true" />
                      </Link>
                    ) : !item.cta ? (
                      <span className="text-[12px] text-ink-3">View only</span>
                    ) : (
                      <span className="text-[12px] text-ink-3">Next step</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="border-t border-line px-4 py-2 sm:px-5">
          <Link
            href="/owner"
            className="inline-flex min-h-11 items-center text-[13px] font-medium text-ink-2 underline underline-offset-2"
          >
            Go to owner home
          </Link>
        </div>
      </section>}
    </OwnerPage>
  );
}
