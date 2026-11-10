import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listNotificationsNeedingAttentionAction } from "@/lib/actions/platform-notifications";
import { listFailedMessagesAction } from "@/lib/actions/platform-failed-notifications";
import { listDeadLetterJobsAction } from "@/lib/actions/platform-jobs";
import {
  RecoveryConsole,
  RecoveryRefusal,
  type RecoveryConsoleData,
} from "@/components/ops/recovery/recovery-console";

// The operator's read-only investigation console for delivery outcomes
// and queued work.
//
// THE READS ARE NOT THIS PAGE'S. It calls the three existing, audited
// list actions — listNotificationsNeedingAttentionAction,
// listFailedMessagesAction and listDeadLetterJobsAction — and renders
// what they return. Each of those actions keeps its own admin gate
// (requireOpsAdminAction) and its own audited operation row
// (runOpsGlobalRead), so this page adds no read, no operation name, no
// permission and no audit of its own. The page is the entry that decides
// WHO may look and WHAT is on screen.
//
// The console is dynamic and private: it reads the platform session
// cookie and renders per request, so it is never cached.
export const dynamic = "force-dynamic";

// The list actions are limit-bounded server actions whose signature is
// (previousState, formData), so the page hands them the bounded
// FormData they parse.
const LIMIT = 50;

function listRequest(): FormData {
  const formData = new FormData();
  formData.set("limit", String(LIMIT));
  return formData;
}

type ListOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A failed read is a bounded state, not a crash.
 *
 * The action either refuses (a typed result) or throws (the audited
 * read failed closed). Both are reported to the operator as "this list
 * could not be read" — the console never pretends an unreadable list is
 * an empty one, and it never changes anything.
 */
async function safeList<T>(
  read: () => Promise<ListOutcome<T>>,
): Promise<ListOutcome<T>> {
  try {
    return await read();
  } catch {
    return { ok: false, error: "unreadable" };
  }
}

export default async function OpsRecoveryPage() {
  // The gate is the FIRST thing the page does, and it is the real
  // session lookup. The refusal order matches the rest of the console:
  // no cookie and an expired cookie go to the sign-in door, a pending
  // second factor goes to the verify door.
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") redirect("/ops/login");
  if (status.kind === "unauthenticated") redirect("/ops/verify");
  // A viewer is refused BEFORE any privileged read. The console is an
  // administrator's investigation surface; the platform permission model
  // is not widened here, and the refusal itself renders no console
  // material at all.
  if (status.role !== "admin") return <RecoveryRefusal />;

  const [attention, failed, deadLetter] = await Promise.all([
    safeList(() => listNotificationsNeedingAttentionAction(null, listRequest())),
    safeList(() => listFailedMessagesAction(null, listRequest())),
    safeList(() => listDeadLetterJobsAction(null, listRequest())),
  ]);

  const data: RecoveryConsoleData = {
    attention: attention.ok ? attention.value : [],
    failed: failed.ok ? failed.value : [],
    deadLetter: deadLetter.ok ? deadLetter.value.jobs : [],
    // The replay limit is the server's own statement, not this page's
    // copy: the dead-letter action returns the truthful availability
    // object with the list.
    replay: deadLetter.ok ? deadLetter.value.replay : null,
    unreadable: {
      attention: !attention.ok,
      failed: !failed.ok,
      deadLetter: !deadLetter.ok,
    },
  };

  return <RecoveryConsole data={data} />;
}
