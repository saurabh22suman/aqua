import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { platformAuditLog } from "./schema/platform-users";
import type { TenantTx } from "./tenant";
import type { UserId } from "@/lib/ids";

// O-05 (docs/ops-platform-design.md §5) — the audited ops mutation
// pipeline.
//
// Every platform console mutation goes through opsAction(). The action
// validates its own input and platform session first (the standing
// server-action preamble), then calls opsAction with the actor and a
// scope from the closed union below. The service doing the write calls
// recordOpsAudit(tx, ...) inside its own transaction, so the audit row
// and the mutation commit together.
//
// The mechanical guarantee is the CI scan (scripts/check-ops-actions.ts):
// every exported mutating action in lib/actions/platform-*.ts must call
// opsAction or be explicitly exempted with a reason. The scan has a
// known-bad fixture it must flag.

export const OPS_SCOPES = [
  "tenant.create",
  "tenant.activate",
  "tenant.suspend",
  "tenant.churn",
  "tenant.invite_owner",
  "tenant.remove_sample_data",
  "tenant.preset.apply",
  "config.set",
  "feature.update",
  "tenant_feature.upsert",
  "tenant_feature.clear",
  "platform_lead.create",
  "platform_lead.update",
  "platform_lead.convert",
  "config.request.resolve",
] as const;

export type OpsScope = (typeof OPS_SCOPES)[number];

const opsActionInput = z.object({
  scope: z.enum(OPS_SCOPES),
  actorId: z.string().uuid(),
  tenantId: z.string().uuid().nullish(),
  reason: z.string().trim().max(500).nullish(),
  targetType: z.string().trim().max(60).nullish(),
  targetId: z.string().uuid().nullish(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type OpsActionInput = z.input<typeof opsActionInput>;

type OpsContext = {
  scope: OpsScope;
  actorId: UserId;
  tenantId: string | null;
  reason: string | null;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown>;
  recorded: boolean;
};

const opsContext = new AsyncLocalStorage<OpsContext>();

export function currentOpsScope(): OpsScope | null {
  return opsContext.getStore()?.scope ?? null;
}

// Wraps a mutation. Validation is strict: an unknown scope or a
// non-uuid actor is a programming error, not user input, so this
// throws rather than returning a result union.
export async function opsAction<T>(
  input: OpsActionInput,
  fn: () => Promise<T>,
): Promise<T> {
  const parsed = opsActionInput.parse(input);
  const context: OpsContext = {
    scope: parsed.scope,
    actorId: parsed.actorId as UserId,
    tenantId: parsed.tenantId ?? null,
    reason: parsed.reason ?? null,
    targetType: parsed.targetType ?? null,
    targetId: parsed.targetId ?? null,
    detail: parsed.detail ?? {},
    recorded: false,
  };
  return opsContext.run(context, fn);
}

export type OpsAuditPayload = {
  // Used when the service is called outside an opsAction context
  // (seeds, tests). Inside opsAction the context's scope/actor win.
  action: OpsScope;
  actorId?: UserId | null;
  tenantId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  detail?: Record<string, unknown>;
};

// Called by services inside their own transaction. Returns true when a
// row was written.
export async function recordOpsAudit(
  tx: TenantTx,
  payload: OpsAuditPayload,
): Promise<void> {
  const context = opsContext.getStore();

  const detail: Record<string, unknown> = { ...(payload.detail ?? {}) };
  if (context) {
    if (payload.before !== undefined) detail.before = payload.before;
    if (payload.after !== undefined) detail.after = payload.after;
    if (context.reason !== null) detail.reason = context.reason;
    Object.assign(detail, context.detail);
  }

  await tx.insert(platformAuditLog).values({
    actorId: context?.actorId ?? payload.actorId ?? null,
    tenantId: context?.tenantId ?? payload.tenantId ?? null,
    action: context?.scope ?? payload.action,
    targetType: context?.targetType ?? payload.targetType ?? null,
    targetId: context?.targetId ?? payload.targetId ?? null,
    detail,
  });

  if (context) context.recorded = true;
}
