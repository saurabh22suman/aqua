import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appendOpsBoundaryEvent } from "@/db/ops-operation-writer";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";

// This initial registry covers only the tax action examples. Extend it
// deliberately as other entry points are migrated.
// The operation registry: ONE name per operation; the OUTCOME says what
// happened. tax.read / tax.set keep their exact approved spelling (the
// stored action names ops.operation.tax.read / ....tax.set must not move).
export type OpsBoundaryOperation =
  | "tax.read"
  | "tax.set"
  | "activity.list"
  | "activity.actions.list"
  // Ops rollout, slice 1 — tenant-detail reads. One name per operation;
  // the outcome (success/invalid/denied/error) says what happened.
  // `tenant.detail` is shared by the overview/audit/entitlements/
  // locations tabs; `tenant.header` by the layout and messaging tab.
  | "tenant.detail"
  | "tenant.header"
  | "tenant.sample_data.state"
  | "tenant.messaging.summary"
  | "config.effective.read"
  | "config.request.list"
  | "config.chain.resolve"
  | "config.audit.list"
  | "tenant.selector.list"
  // Ops rollout, slice 2 — platform-wide reads and the mutating
  // operations whose refusals and failures are traced.
  | "platform.metrics.summary"
  | "tenant.health.queue"
  | "feature.catalogue.list"
  | "lead.list"
  | "preset.list"
  | "preset.preview"
  | "tenant.list"
  | "plan.list"
  | "message.list"
  | "lead.detail"
  | "preset.detail"
  | "location.list"
  | "tenant.create"
  | "tenant.activate"
  | "tenant.suspend"
  | "tenant.churn"
  | "tenant.invite_owner"
  | "tenant.owner_login_link.issue"
  | "tenant.owner_reset_link.issue"
  | "tenant.preset.apply"
  | "tenant.remove_sample_data"
  | "feature.update"
  | "tenant_feature.upsert"
  | "tenant_feature.clear"
  | "config.request.resolve"
  | "platform_lead.create"
  | "platform_lead.update"
  | "platform_lead.convert"
  | "message.send"
  | "message.inbound"
  // F08/F09 recovery surfaces (lane E, rev 9) — SEVEN additive operation
  // names, one per operation, spelled exactly as the OPS_SCOPES members this
  // proposal adds. Additive only: the names already in this registry keep
  // their exact spelling and the stored action names do not move.
  | "notification.list_attention"
  | "notification.resend"
  | "notification.close"
  | "notification.list_failed"
  | "notification.retry_failed"
  | "notification.dismiss"
  | "job.dead_letter.list";
export type OpsBoundaryOutcome =
  | "success"
  | "invalid"
  | "denied"
  | "error"
  | "noop";
export type OpsAuditOrigin =
  | "server_action"
  | "ops_page"
  | "http_route"
  | "internal_call";
type Actor = { kind: "authenticated"; userId: string; role: "admin" | "viewer" }
  | { kind: "anonymous" };

export function auditUnavailable(operation: OpsBoundaryOperation, correlationId: string): never {
  console.error("OPS_AUDIT_UNAVAILABLE", { operation, correlationId });
  throw new Error(`Ops audit unavailable (reference ${correlationId}).`);
}

async function actorForBoundary(operation: OpsBoundaryOperation, correlationId: string): Promise<Actor> {
  let status: Awaited<ReturnType<typeof platformAuthStatusAction>>;
  try {
    status = await platformAuthStatusAction();
  } catch {
    return auditUnavailable(operation, correlationId);
  }
  return status.kind === "authenticated"
    ? { kind: "authenticated", userId: status.userId, role: status.role }
    : { kind: "anonymous" };
}

async function persist(
  operation: OpsBoundaryOperation,
  outcome: OpsBoundaryOutcome,
  actorId: string,
  correlationId: string,
  tenantId: string | undefined,
  origin: OpsAuditOrigin,
): Promise<void> {
  try {
    await appendOpsBoundaryEvent(operation, outcome, actorId, correlationId, tenantId, origin);
  } catch {
    auditUnavailable(operation, correlationId);
  }
}

// Audit must commit before a read result can leave the server. A failed
// audit propagates; a failed read produces only a sanitized failure event.
export async function runOpsRead<T>(
  operation: OpsBoundaryOperation,
  tenantId: string,
  read: () => Promise<T>,
  origin: OpsAuditOrigin = "server_action",
  correlationId: string = randomUUID(),
): Promise<T | null> {
  const actor = await actorForBoundary(operation, correlationId);
  // ANONYMOUS CALLERS ARE NOT OPS OPERATIONS: no row (lane A owns the
  // bounded pre-auth events). The failure mode is "no limit", never an
  // unbounded write from an unauthenticated caller.
  if (actor.kind !== "authenticated") return null;
  // The approved invalid-tenant semantics, unchanged: a malformed tenant
  // writes an "invalid" row and returns null. The row carries NO tenant id —
  // the malformed value must never reach the writer's uuid parse.
  if (!z.string().uuid().safeParse(tenantId).success) {
    await persist(operation, "invalid", actor.userId, correlationId, undefined, origin);
    return null;
  }
  let result: T;
  try {
    result = await read();
  } catch {
    await persist(operation, "error", actor.userId, correlationId, tenantId, origin);
    throw new Error(`Ops read failed (reference ${correlationId}).`);
  }
  await persist(operation, "success", actor.userId, correlationId, tenantId, origin);
  return result;
}

// The GLOBAL read: the same contract with NO tenant, for the operations that
// read the whole platform.
export async function runOpsGlobalRead<T>(
  operation: OpsBoundaryOperation,
  read: () => Promise<T>,
  origin: OpsAuditOrigin = "server_action",
  correlationId: string = randomUUID(),
): Promise<T | null> {
  const actor = await actorForBoundary(operation, correlationId);
  if (actor.kind !== "authenticated") return null;
  let result: T;
  try {
    result = await read();
  } catch {
    await persist(operation, "error", actor.userId, correlationId, undefined, origin);
    throw new Error(`Ops read failed (reference ${correlationId}).`);
  }
  await persist(operation, "success", actor.userId, correlationId, undefined, origin);
  return result;
}

// Use only before a mutation begins. A committed mutation must not depend
// on a second post-commit operation write. This is not a mutation wrapper.
export async function recordOpsRejection(
  operation: OpsBoundaryOperation,
  outcome: "invalid" | "denied",
  tenantId?: string,
): Promise<void> {
  const correlationId = randomUUID();
  const actor = await actorForBoundary(operation, correlationId);
  if (actor.kind !== "authenticated") return;
  await persist(operation, outcome, actor.userId, correlationId, tenantId, "server_action");
}

// The DEFERRED mutation trace for a mutation that did NOT commit. Bounded and
// NEVER throwing: its own failure logs the fixed alert once; an actor-lookup
// failure is already logged by actorForBoundary (auditUnavailable) and is not
// logged twice here.
export async function recordOpsMutationTrace(
  operation: OpsBoundaryOperation,
  outcome: "denied" | "invalid" | "error",
  input: { tenantId?: string; origin?: OpsAuditOrigin } = {},
): Promise<void> {
  const correlationId = randomUUID();
  let actor: Actor;
  try {
    actor = await actorForBoundary(operation, correlationId);
  } catch {
    return;
  }
  if (actor.kind !== "authenticated") return;
  // A target id is stored only when it is a VALID uuid. Some actions take
  // the tenant id from the request without parsing it, and a malformed
  // value must never reach the writer's uuid parse: that would raise
  // inside the write and lose the trace altogether. A malformed id is
  // simply not recorded.
  const tenantId =
    input.tenantId !== undefined && z.string().uuid().safeParse(input.tenantId).success
      ? input.tenantId
      : undefined;
  try {
    await appendOpsBoundaryEvent(
      operation,
      outcome,
      actor.userId,
      correlationId,
      tenantId,
      input.origin ?? "server_action",
    );
  } catch {
    console.error("OPS_AUDIT_UNAVAILABLE", { operation, correlationId });
  }
}

// The THROWN-failure trace: the mutation raised instead of returning a
// result, so nothing was committed by the audited pipeline — but the
// caller still gets the original error.
//
// A permission refusal is a DENIAL, not an unexpected failure: db/ops-action
// re-reads the actor row inside the pipeline and refuses a viewer, a
// suspended account or an unknown actor BEFORE the service runs. The
// refusal is detected by the error's own name, never by a caller-supplied
// string.
//
// TRUTHFULNESS: the trace says "the call failed". It never says "nothing
// committed": a service that commits and then raises would still be
// reported as a failure here, and the domain audit inside the mutation
// transaction stays the authority on what was written.
export async function recordOpsThrownFailure(
  operation: OpsBoundaryOperation,
  error: unknown,
  input: { tenantId?: string; origin?: OpsAuditOrigin } = {},
): Promise<void> {
  const denied = isOpsForbiddenError(error);
  await recordOpsMutationTrace(operation, denied ? "denied" : "error", input);
}

// The refusal raised by db/ops-action's defence-in-depth actor check.
// Detected by the error's own name so this module does not have to import
// the pipeline (and the pipeline does not have to import this module).
function isOpsForbiddenError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "OpsForbiddenError"
  );
}
