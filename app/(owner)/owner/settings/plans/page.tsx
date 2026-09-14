import Link from "next/link";
import { requireOwner } from "@/lib/auth/surface-guard";
import {
  listPlanTemplatesAction,
  listPlansAction,
} from "@/lib/actions/membership-plans";
import { PlanManager } from "@/components/plan-manager";

// C-29 — owner surface for membership plans: preset templates become
// sellable plans once priced; custom plans can be added directly.

export default async function PlansPage() {
  await requireOwner();
  const [templates, plans] = await Promise.all([
    listPlanTemplatesAction(),
    listPlansAction(),
  ]);

  return (
    <main className="px-5 pt-6 pb-8 max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/owner/settings"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Settings
        </Link>
        {" / "}
        plans
      </p>
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Membership plans
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        What the academy sells: durations, session packs and one-time
        plans. Subscriptions are started from a member&apos;s page.
      </p>
      <div className="mt-5">
        <PlanManager templates={templates} plans={plans} />
      </div>
    </main>
  );
}
