import Link from "next/link";
import { OpsCardFlush, OpsPage, OpsPageHeader, OpsPanel } from "@/components/ops/ops-primitives";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import type { SystemEvidence } from "@/db/ops-system-evidence";

const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/** The administrator-only refusal. It names no evidence. */
export function SystemRefusal() {
  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Operator console"
        title="Administrator access required"
        lede="This system evidence view is limited to administrator accounts. Your platform account can browse the rest of the console, but it cannot open this view."
      />
      <OpsPanel tone="pending" className="mt-6" title="Nothing was read">
        The refusal happens before any platform data is read, so no evidence was
        loaded for this request.
      </OpsPanel>
    </OpsPage>
  );
}

const WORKER_LABEL: Record<string, string> = {
  healthy: "Healthy",
  stale: "Stale",
  absent: "Absent",
  unreadable: "Unreadable",
};

const PROVIDER_LABEL: Record<string, string> = {
  mock: "Mock",
  capture: "Capture",
  disabled: "Disabled",
  unsupported: "Unsupported",
};

export function SystemEvidencePanel({
  evidence,
}: {
  evidence: SystemEvidence;
}) {
  const workerTone: StatusTone =
    evidence.worker.state === "healthy"
      ? "good"
      : evidence.worker.state === "stale"
        ? "warn"
        : evidence.worker.state === "absent"
          ? "late"
          : "neutral";
  return (
    <OpsCardFlush>
      <EvidenceRow
        label="Database"
        state={evidence.database.state === "reachable" ? "Reachable" : "Unreachable"}
        tone={evidence.database.state === "reachable" ? "good" : "late"}
        detail={evidence.database.detail}
      />
      <EvidenceRow
        label="Worker"
        state={WORKER_LABEL[evidence.worker.state] ?? evidence.worker.state}
        tone={workerTone}
        detail={evidence.worker.detail}
        extra={
          evidence.worker.lastSeenAt
            ? `Last seen ${DATETIME_FMT.format(new Date(evidence.worker.lastSeenAt))} IST`
            : null
        }
      />
      <EvidenceRow
        label="Messaging provider"
        state={PROVIDER_LABEL[evidence.provider.state] ?? evidence.provider.state}
        tone="neutral"
        detail={evidence.provider.detail}
        extra={
          evidence.provider.configured
            ? "A provider name is configured in the environment."
            : "No provider name is configured; the default applies."
        }
      />
      <EvidenceRow
        label="Object store"
        state={
          evidence.storage.state === "configured" ? "Configured" : "Not configured"
        }
        tone="neutral"
        detail={evidence.storage.detail}
        extra="The runbook is docs/deployment.md, section “Backups and restore”."
      />
    </OpsCardFlush>
  );
}

function EvidenceRow({
  label,
  state,
  tone,
  detail,
  extra,
}: {
  label: string;
  state: string;
  tone: StatusTone;
  detail: string;
  extra?: string | null;
}) {
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <StatusBadge tone={tone}>{state}</StatusBadge>
      </div>
      <p className="mt-1 text-[12px] text-ink-2">{detail}</p>
      {extra ? <p className="mt-0.5 text-[12px] text-ink-3">{extra}</p> : null}
    </div>
  );
}

/** The queued-work summary. The list itself lives on the recovery console. */
export function SystemQueueSummary({
  count,
  unreadable,
}: {
  count: number;
  unreadable: boolean;
}) {
  if (unreadable) {
    return (
      <OpsPanel tone="error" title="This list could not be read">
        The platform refused or failed the read, so nothing is shown here. Nothing was
        changed.
      </OpsPanel>
    );
  }
  return (
    <div className="rounded-card border border-line bg-paper px-4 py-3">
      <p className="text-[13px] text-ink">
        {count} dead-letter {count === 1 ? "job is" : "jobs are"} shown (at most 50).
      </p>
      <p className="mt-1 text-[12px] text-ink-3">
        Only safe metadata is shown there: an id, the source queue, the club, the
        attempt count and the creation time. No payload, no output and no error text.
      </p>
      <p className="mt-2">
        <Link
          href="/ops/recovery"
          className="text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
        >
          Open the recovery console
        </Link>
      </p>
    </div>
  );
}
