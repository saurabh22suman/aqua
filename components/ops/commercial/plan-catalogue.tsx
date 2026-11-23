import Link from "next/link";
import type { CataloguePlan } from "@/db/saas-plan-catalogue";
import { formatINR } from "@/lib/money/format";
import {
  OpsCard,
  OpsCardFlush,
  OpsEmptyState,
  OpsSection,
} from "@/components/ops/ops-primitives";
import { OpsRecordTitle } from "@/components/ops/console/ops-record-title";
import { buttonClasses } from "@/components/ui/Button";

// The read-only SaaS plan catalogue (Ops completion, 9 November 2026).
//
// THE HEADING VOCABULARY: a SECTION title is an h2 (OpsSection) and a
// RECORD title — a plan — is an h3. The plan name used to be an h2 in
// the display face at 20px, so the same heading level meant "section"
// on one screen and "plan" on the next, in three different sizes.
//
// THE IDENTIFIER: the card shows the plan's KEY — the slug that appears
// in the URLs and that an operator quotes — and never the row's
// internal UUID, which is not something an operator can act on.
//
// THE COMMERCIAL TERMS ARE STATED ONCE: they are not configured, and
// the page says so once, in one panel, above the catalogue. Repeating
// the same sentence on every card was noise, not information. The
// meaning is unchanged — no price, no terms and no quota is claimed
// anywhere.
//
// THE CARD ACTIONS LINE UP: the cards are a grid row, so they share a
// height, and each card's action sits at the bottom of its own card —
// one row of aligned actions instead of a ragged edge.

function price(plan: CataloguePlan): string {
  if (plan.pricePaise === null) return "Price not set";
  return plan.currency === "INR"
    ? `Recorded price ${formatINR(plan.pricePaise)}`
    : `Price recorded in ${plan.currency}`;
}

export function PlanCatalogue({
  plans,
  canCreate = false,
}: {
  plans: readonly CataloguePlan[];
  canCreate?: boolean;
}) {
  const offered = plans.filter(
    (p) => p.status === "active" && p.availableForNewTenants,
  );
  const legacy = plans.filter(
    (p) => p.status !== "active" || !p.availableForNewTenants,
  );
  return (
    <div className="mt-6 space-y-6">
      <OpsSection
        title="Plans for new clubs"
        subtitle="A new club starts on one of these. Existing clubs keep the plan and the access they already have."

      >
        {offered.length ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {offered.map((plan) => (
              <OpsCard key={plan.id} className="flex flex-col p-5">
                <OpsRecordTitle>{plan.name}</OpsRecordTitle>
                <p className="mt-2 text-[14px] text-ink-2">{price(plan)}</p>
                {plan.isDefault ? (
                  <p className="mt-2 text-[12px] text-ink-2">
                    Default for new clubs
                  </p>
                ) : null}
                <p className="mt-3 text-[12px] text-ink-3">
                  Plan key{" "}
                  <span className="font-mono text-ink-2">{plan.key}</span>
                </p>
                {canCreate ? (
                  <div className="mt-auto pt-4">
                    <Link
                      className={buttonClasses({
                        variant: "secondary",
                        size: "sm",
                      })}
                      href={`/ops/tenants/new?plan=${encodeURIComponent(plan.key)}`}
                    >
                      Start trial on {plan.name}
                    </Link>
                  </div>
                ) : null}
              </OpsCard>
            ))}
          </div>
        ) : (
          <OpsEmptyState
            title="No plans available for new clubs"
            body="The catalogue has no active signup-eligible plan. Existing club assignments are preserved."
          />
        )}
      </OpsSection>

      <OpsSection
        title="Trial"
        subtitle="A trial uses a selected plan. It is a club status, not a fourth paid plan."
      >
        <OpsCard className="p-5">
          <p className="text-[13px] text-ink-2">
            Trial expiry, where recorded, is reviewed manually. This page
            sets no trial duration and does not automatically activate,
            suspend or bill a club.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              href="/ops/tenants?status=trial"
            >
              View trial clubs
            </Link>
            <Link
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              href="/ops/tenants?status=trial&trial=expired"
            >
              Review expired trials
            </Link>
          </div>
        </OpsCard>
      </OpsSection>

      {legacy.length ? (
        <OpsSection
          title="Legacy plans · existing clubs"
          subtitle="These remain visible for existing assignments and tenant filters. They are not offered for new clubs; access follows each stored plan’s status."
        >
          <OpsCardFlush>
            <ul>
              {legacy.map((plan) => (
                <li
                  key={plan.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <span className="text-[14px] font-medium text-ink">
                    {plan.name}
                  </span>
                  <span className="font-mono text-[12px] text-ink-3">
                    {plan.key}
                  </span>
                </li>
              ))}
            </ul>
          </OpsCardFlush>
        </OpsSection>
      ) : null}
    </div>
  );
}
