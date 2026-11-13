import { listMemberEnrolmentsAction } from "@/lib/actions/enrolment";
import { listBatchesAction } from "@/lib/actions/programs";
import { listMemberSubscriptionsAction, listMemberSubscriptionPlansAction } from "@/lib/actions/subscriptions";
import {
  listMakeupCreditsAction,
  listMakeupSourcesAction,
  listMakeupTargetsAction,
} from "@/lib/actions/makeup";
import type {
  MemberEnrolmentSeed,
  MemberMakeupSeed,
  MemberSubscriptionSeed,
} from "@/components/member-detail/member-panel-initial-data";

// Owner member detail — the Owner-only read composition for the enrolment and
// subscription panels.
//
// It calls the SAME actions the panels call, so session, permission, location
// and data validation are unchanged; it only moves the read from a client
// mount effect to the already-authorized server render. Both pairs run
// concurrently. A rejected pair becomes `{ failed: true }` — never an empty
// list — so the panel's existing error + Retry is what the owner sees.
//
// Used only by the owner overview. Every other consumer (reception, coach,
// the payments/notes tabs) keeps the panels' own mount read.

async function readEnrolment(memberId: string): Promise<MemberEnrolmentSeed> {
  try {
    const [enrolments, batches] = await Promise.all([
      listMemberEnrolmentsAction(memberId),
      listBatchesAction(),
    ]);
    return { memberId, enrolments, batches };
  } catch {
    return { memberId, failed: true };
  }
}

async function readSubscription(
  memberId: string,
): Promise<MemberSubscriptionSeed> {
  try {
    const [subscriptions, plans] = await Promise.all([
      listMemberSubscriptionsAction(memberId),
      listMemberSubscriptionPlansAction(memberId),
    ]);
    return { memberId, subscriptions, plans };
  } catch {
    return { memberId, failed: true };
  }
}

async function readMakeup(memberId: string): Promise<MemberMakeupSeed> {
  try {
    const [credits, sources, targets] = await Promise.all([
      listMakeupCreditsAction(memberId),
      listMakeupSourcesAction(memberId),
      listMakeupTargetsAction(memberId),
    ]);
    return { memberId, credits, sources, targets };
  } catch {
    return { memberId, failed: true };
  }
}

export async function readOwnerMemberInitialPanels(memberId: string): Promise<{
  enrolment: MemberEnrolmentSeed;
  subscription: MemberSubscriptionSeed;
  makeup: MemberMakeupSeed;
}> {
  const [enrolment, subscription, makeup] = await Promise.all([
    readEnrolment(memberId),
    readSubscription(memberId),
    readMakeup(memberId),
  ]);
  return { enrolment, subscription, makeup };
}
