import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "./scope";

// F08 (composed, rev 3) — the platform read behind the Ops console's
// "needs attention" list: the tenant notifications whose delivery outcome
// is UNKNOWN, or whose attempts are exhausted (so the job will never
// touch them again).
//
// THE READ GOES THROUGH A PROJECTION FUNCTION, NOT THE TABLE. The outbox
// has FORCE ROW LEVEL SECURITY and only a tenant_isolation policy, so a
// plain platform-scoped read of it returns ZERO ROWS. The alternative —
// granting platform_admin_select on the outbox — would hand platform-wide
// SELECT over the message BODY and the PHONE of every notification to
// every query running under app.platform_admin. The projection function
// (added by the F08 migration) returns ONLY the safe columns: a masked
// phone, the CLASSIFIED reason and the event KIND. No body, no raw phone,
// no raw provider error, no job data.
//
// The function is GUARDED INSIDE ITSELF by the existing platform scope
// GUC (app.platform_admin), so it returns zero rows outside the platform
// scope. The runtime role is app_user, and EXECUTE has to be granted to
// it for the app to call the function at all — without the guard, any
// tenant-scoped SQL path that could call it would enumerate the
// CROSS-TENANT attention list. The masking limits the columns, not the
// rows.
//
// Owner: b-isolation. The audited action that calls this file is in
// lib/actions/platform-notifications.ts; the audit row is written THERE,
// so this file stays a pure read.

export type OpsNotificationAttentionRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  status: string;
  attempts: number;
  eventKind: string | null;
  phoneMasked: string | null;
  failureReason: string | null;
  claimedAt: string | null;
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

export async function listNotificationsNeedingAttention(
  limit = 50,
): Promise<OpsNotificationAttentionRow[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return withPlatformAdmin(async (tx) => {
    const result = await tx.execute(sql`
      select
        id,
        tenant_id,
        tenant_name,
        status,
        attempts,
        event_kind,
        phone_masked,
        failure_reason,
        claimed_at,
        created_at
      from ops_notification_attention(${safeLimit})
    `);
    type RowShape = {
      id: string;
      tenant_id: string;
      tenant_name: string;
      status: string;
      attempts: number;
      event_kind: string | null;
      phone_masked: string | null;
      failure_reason: string | null;
      // The raw projection read returns the server's TEXT for a timestamptz
      // (see toIso above), so the types are widened at this boundary.
      claimed_at: Date | string | null;
      created_at: Date | string;
    };
    const rows = (result as unknown as { rows: RowShape[] }).rows;
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      status: row.status,
      attempts: Number(row.attempts),
      eventKind: row.event_kind,
      phoneMasked: row.phone_masked,
      failureReason: row.failure_reason,
      claimedAt: row.claimed_at ? toIso(row.claimed_at) : null,
      createdAt: toIso(row.created_at),
    }));
  });
}

export async function countNotificationsNeedingAttention(): Promise<number> {
  return withPlatformAdmin(async (tx) => {
    const result = await tx.execute(sql`
      select ops_notification_attention_count() as n
    `);
    type RowShape = { n: number };
    const rows = (result as unknown as { rows: RowShape[] }).rows;
    return Number(rows[0]?.n ?? 0);
  });
}
