import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { listDeadLetterJobsAction } from "@/lib/actions/platform-jobs";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";
import { getSystemEvidence } from "@/db/ops-system-evidence";
import { OpsPage, OpsPageHeader, OpsPanel, OpsSection } from "@/components/ops/ops-primitives";
import { SystemEvidencePanel, SystemQueueSummary, SystemRefusal } from "./system-evidence-sections";

export const dynamic = "force-dynamic";

const LIMIT = 50;

type ListOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A failed read is a bounded state, not a crash: the console never
 * pretends an unreadable list is an empty one.
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

function listRequest(): FormData {
  const formData = new FormData();
  formData.set("limit", String(LIMIT));
  return formData;
}

export default async function OpsSystemEvidencePage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") redirect("/ops/login");
  if (status.kind === "unauthenticated") redirect("/ops/verify");
  // A viewer is refused BEFORE any read, the way /ops/recovery refuses
  // one. The refusal renders no evidence at all.
  if (status.role !== "admin") return <SystemRefusal />;

  const evidence = await runOpsGlobalRead(
    "system.evidence.read",
    () => getSystemEvidence(),
    "ops_page",
  );
  if (!evidence) redirect("/ops/login");

  const deadLetter = await safeList(() =>
    listDeadLetterJobsAction(null, listRequest()),
  );

  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Investigation"
        title="System evidence"
        lede="What the running system can actually be shown to have done: the database, the worker, the messaging provider, and whether the object store is configured at all."
        meta="Live read · never cached"
      />

      <OpsPanel tone="pending" className="mt-6" title="Evidence, not a health score">
        Nothing on this page runs a backup, a restore or a provider test, and
        nothing on it proves that a delivery or a restore happened. A row that
        cannot be read says so instead of showing a zero.
      </OpsPanel>

      <section className="mt-8">
        <OpsSection
          title="Runtime"
          subtitle="Live reads. A state that is configured is not a state that is working."
        />
        <SystemEvidencePanel evidence={evidence} />
      </section>

      <section className="mt-8">
        <OpsSection
          title="Queued work"
          subtitle="The dead-letter queue, read through its own audited action. The list itself lives on the recovery console."
        />
        <SystemQueueSummary
          count={deadLetter.ok ? deadLetter.value.jobs.length : 0}
          unreadable={!deadLetter.ok}
        />
      </section>
    </OpsPage>
  );
}
