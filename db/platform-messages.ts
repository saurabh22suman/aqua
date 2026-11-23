import { desc, eq, sql } from "drizzle-orm";
import { withPlatformAdmin } from "./scope";
import { messageLog } from "./schema/message-log";
import { tenants } from "./schema/tenants";

// C-40a — platform-side read for the non-production WhatsApp mock
// screen. It lists the tenant's messages alongside the tenant name so
// the operator can see what the mock actually recorded.

export type OpsMessageRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  direction: "outbound" | "inbound";
  provider: string;
  providerMessageId: string | null;
  toPhone: string | null;
  fromPhone: string | null;
  templateKey: string | null;
  body: string | null;
  status: string;
  category: string;
  costPaise: bigint;
  createdAt: string;
};

// F08-B (composed, rev 3) — the failed attempts.
//
// The Ops console reads message_log, so a failed send that is recorded
// there is visible; one that is not recorded is invisible. That is the
// whole point of the ledger change.
//
// THE PROJECTION MASKS AND DROPS. It returns a MASKED phone, NO body
// and the CLASSIFIED reason — never the provider's own error text, which
// can echo the recipient's phone number and would defeat the masking one
// column above. It is guarded inside itself by the existing platform
// scope GUC, so the tenant runtime role gets zero rows.
//
// It does not depend on the pre-existing blanket platform_admin_select
// policy on message_log, and this change does NOT touch that policy:
// narrowing it would be an unapproved grant change.
export type OpsFailedMessageRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  provider: string;
  phoneMasked: string | null;
  status: string;
  category: string;
  consentClass: string | null;
  failureReason: string | null;
  createdAt: string;
};

// A RAW projection read returns the server's TEXT for a timestamptz.
// Drizzle's node-postgres driver overrides pg's date/time type parsers
// (node_modules/drizzle-orm/node-postgres/session.js), and a raw sql
// template has no fields to re-map, so the value arrives as the rendered
// timestamptz rather than as a Date. It is an INSTANT rendered in the
// session time zone, so it is parsed as an instant — never as a wall
// clock — and returned as the exact ISO form the callers expect.
function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export async function listFailedMessages(limit = 50): Promise<OpsFailedMessageRow[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return withPlatformAdmin(async (tx) => {
    const result = await tx.execute(sql`
      select
        id,
        tenant_id,
        tenant_name,
        provider,
        phone_masked,
        status,
        category,
        consent_class,
        failure_reason,
        created_at
      from ops_failed_messages(${safeLimit})
    `);
    type RowShape = {
      id: string;
      tenant_id: string;
      tenant_name: string;
      provider: string;
      phone_masked: string | null;
      status: string;
      category: string;
      consent_class: string | null;
      failure_reason: string | null;
      // The raw projection read returns the server's TEXT for a timestamptz
      // (see toIso above), so the type is widened at this boundary.
      created_at: Date | string;
    };
    const rows = (result as unknown as { rows: RowShape[] }).rows;
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      provider: row.provider,
      phoneMasked: row.phone_masked,
      status: row.status,
      category: row.category,
      consentClass: row.consent_class,
      failureReason: row.failure_reason,
      createdAt: toIso(row.created_at),
    }));
  });
}

export async function countFailedMessages(): Promise<number> {
  return withPlatformAdmin(async (tx) => {
    const result = await tx.execute(sql`
      select ops_failed_messages_count() as n
    `);
    type RowShape = { n: number };
    const rows = (result as unknown as { rows: RowShape[] }).rows;
    return Number(rows[0]?.n ?? 0);
  });
}

export async function listRecentMessages(
  limit = 50,
): Promise<OpsMessageRow[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return withPlatformAdmin(async (tx) => {
    const rows = await tx
      .select({ message: messageLog, tenantName: tenants.name })
      .from(messageLog)
      .innerJoin(tenants, eq(tenants.id, messageLog.tenantId))
      .orderBy(desc(messageLog.createdAt))
      .limit(safeLimit);
    return rows.map(({ message, tenantName }) => ({
      id: message.id,
      tenantId: message.tenantId,
      tenantName,
      direction: message.direction as "outbound" | "inbound",
      provider: message.provider,
      providerMessageId: message.providerMessageId,
      toPhone: message.toPhone,
      fromPhone: message.fromPhone,
      templateKey: message.templateKey,
      body: message.body,
      status: message.status,
      category: message.category,
      costPaise: message.costPaise,
      createdAt: message.createdAt.toISOString(),
    }));
  });
}
