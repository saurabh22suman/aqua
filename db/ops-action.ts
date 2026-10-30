import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./client";
import { withPlatform } from "./scope";
import { platformAuditLog, platformUsers } from "./schema/platform-users";
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
  "tenant.owner_login_link.issue",
  "tenant.owner_reset_link.issue",
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
  "message.send",
  "message.inbound",
  // F08+F09 (composed, rev 3) — the operator surfaces for the
  // notification recovery work and the dead-letter queue. ALL SEVEN
  // scopes land in THIS ONE hunk: the union is a closed list, so two
  // patches cannot both edit it (review P0-2).
  //
  // The three READS are audited like the mutations: a privileged read
  // that changes nothing still writes a platform_audit_log row.
  "notification.list_attention",
  "notification.resend",
  "notification.close",
  "notification.list_failed",
  "notification.retry_failed",
  "notification.dismiss",
  "job.dead_letter.list",
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

export function currentOpsActorId(): UserId | null {
  return opsContext.getStore()?.actorId ?? null;
}

// Wraps a mutation. Validation is strict: an unknown scope or a
// non-uuid actor is a programming error, not user input, so this
// throws rather than returning a result union.
//
// R03 (2026-10-13 role-workflow audit) — defence in depth: the actor's
// platform role and status are re-read from platform_users before the
// mutation callback can run. Actions already gate on the
// session-validated role (requireOpsAdminAction); this catches any
// future caller that reaches opsAction without that gate. Viewers,
// suspended actors and unknown actor ids are refused before any
// write, enqueue or audit side effect. Internal background callers use
// recordOpsAudit outside an opsAction context and are unaffected.
export class OpsForbiddenError extends Error {
  constructor() {
    super("forbidden: platform actor is not an active admin");
    this.name = "OpsForbiddenError";
  }
}

export async function opsAction<T>(
  input: OpsActionInput,
  fn: () => Promise<T>,
): Promise<T> {
  const parsed = opsActionInput.parse(input);
  // Platform scope: the role lookup is a platform-table read, so it
  // declares withPlatform() like every other platform query.
  const actor = await withPlatform(async () => {
    const [row] = await db
      .select({ role: platformUsers.role, status: platformUsers.status })
      .from(platformUsers)
      .where(eq(platformUsers.id, parsed.actorId))
      .limit(1);
    return row;
  });
  if (!actor || actor.role !== "admin" || actor.status !== "active") {
    throw new OpsForbiddenError();
  }
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

// The IN-TRANSACTION noop evidence. A mutation that committed but changed
// nothing still has evidence, written in its own transaction so it commits or
// rolls back with the mutation — never a post-commit write.
//
// The scope and the actor come from the opsAction context and are NEVER
// invented: outside that context this is a programming error, not a
// config.set row with a null actor.
//
// The caller states ITS OWN scope, actor and tenant, and they must match the
// ambient context exactly. An ambient context must not be allowed to label a
// noop with another operation's scope, actor or tenant: the noop evidence is
// only truthful when it describes the operation that actually ran.
export async function recordOpsNoop(
  tx: TenantTx,
  input: {
    correlationId: string;
    origin: "server_action" | "ops_page" | "http_route" | "internal_call";
    scope: OpsScope;
    actorId: UserId;
    tenantId: string | null;
  },
): Promise<void> {
  const context = opsContext.getStore();
  if (!context) throw new Error("recordOpsNoop: no opsAction context");
  if (
    context.scope !== input.scope ||
    context.actorId !== input.actorId ||
    context.tenantId !== input.tenantId
  ) {
    throw new Error("recordOpsNoop: operation context mismatch");
  }
  await recordOpsAudit(tx, {
    action: context.scope,
    detail: { outcome: "noop", correlationId: input.correlationId, origin: input.origin },
  });
}
