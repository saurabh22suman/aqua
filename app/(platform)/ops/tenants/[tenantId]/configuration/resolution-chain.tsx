import type { ConfigChainEntry } from "@/db/config";
import type { TenantConfigAuditEntry } from "@/db/tenant-config-audit";

// PR5 (ops console improvements) — "why this value" as a full
// waterfall: every level's value, not only the winner. Read-only
// rendering of db/config.ts::resolveConfigChain's output.

const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const LEVEL_LABEL: Record<ConfigChainEntry["scopeType"], string> = {
  platform: "Platform default",
  plan: "Plan",
  preset: "Preset",
  tenant: "Tenant",
  location: "Location",
  activity: "Activity",
};

function renderValue(value: unknown): string {
  if (value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ResolutionChain({
  configKey,
  chain,
  auditLog,
}: {
  configKey: string;
  chain: ConfigChainEntry[];
  auditLog: TenantConfigAuditEntry[];
}) {
  return (
    <div className="rounded-card bg-paper border border-line overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
          Why this value?
        </p>
        <p className="mt-1 font-mono text-[13px] text-ink">{configKey}</p>
      </div>
      <ul>
        {chain.map((entry) => (
          <li
            key={entry.scopeType}
            className={`flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line last:border-b-0 ${
              entry.isWinner ? "bg-water-soft" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="text-[13px] text-ink">
                {LEVEL_LABEL[entry.scopeType]}
              </p>
              <p
                className={`mt-0.5 text-[13px] ${
                  entry.value === undefined ? "text-ink-3" : "text-ink font-medium"
                }`}
              >
                {renderValue(entry.value)}
              </p>
            </div>
            {entry.isWinner ? (
              <span className="shrink-0 rounded-pill bg-water px-2 py-0.5 text-[11px] font-medium text-paper">
                Applied
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="px-4 py-3 border-t border-line">
        <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
          Configuration audit log
        </p>
        {auditLog.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink-3">
            No recorded changes to this key for this tenant.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {auditLog.map((entry) => (
              <li key={entry.id} className="text-[12px] text-ink-2">
                <span className="font-medium text-ink">{entry.actorLabel}</span>{" "}
                {entry.action} · {DATETIME_FMT.format(entry.createdAt)} IST
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
