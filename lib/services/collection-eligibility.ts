import { and, eq, getTableName, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { bookings } from "@/db/schema/bookings";
import type { TenantTx } from "@/db/tenant";
import {
  COLLECTION_HOLD_BOOKING_CANCELLED,
  type CollectionHold,
} from "@/lib/collection-hold";
import type { TenantId } from "@/lib/ids";

// Local KhelSuite audit batch (2026-11-21) — collection eligibility for an
// invoice whose linked booking was cancelled.
//
// The confirmed policy is "hold collection for owner review": the issued
// or partial balance remains visible with its existing amounts and
// receipts, but a NEW payment is refused. Nothing is voided, refunded,
// reversed or released automatically.
//
// This module is server-only by construction (it imports the database
// schema and a transaction type); client surfaces import only
// lib/collection-hold.ts.

function qualified(column: AnyPgColumn): SQL {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}

/**
 * The stable hold field for invoice read projections.
 *
 * A correlated EXISTS subquery, never a join: a document with more than
 * one historical booking link still yields exactly one result row. The
 * lookup is tenant-scoped, and the outer invoice columns are
 * hand-qualified so the subquery cannot collide with its own
 * tenant_id / invoice_id columns.
 *
 * The expression does not look at the invoice status, so a hold remains
 * useful history after the document closes (paid or void).
 */
export function invoiceCollectionHoldSql(
  tenantColumn: AnyPgColumn,
  invoiceIdColumn: AnyPgColumn,
): SQL<string | null> {
  const tenant = qualified(tenantColumn);
  const invoiceId = qualified(invoiceIdColumn);
  return sql<string | null>`case when exists (
    select 1
      from bookings b
     where b.tenant_id = ${tenant}
       and b.invoice_id = ${invoiceId}
       and b.status = 'cancelled'
  ) then ${COLLECTION_HOLD_BOOKING_CANCELLED} else null end`;
}

export type LinkedBookingLockRow = {
  id: string;
  status: string;
};

/**
 * Lock every booking linked to this invoice, in a deterministic order.
 *
 * Booking billing reads and locks the booking row before the invoice row,
 * so the payment path takes the same two rows in the same order. The
 * advisory intent lock (when present) is still taken first, preserving
 * the existing F01 per-target convention.
 */
export async function lockInvoiceBookingsInTx(
  tx: TenantTx,
  tenantId: TenantId,
  invoiceId: string,
): Promise<LinkedBookingLockRow[]> {
  return tx
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(
      and(eq(bookings.tenantId, tenantId), eq(bookings.invoiceId, invoiceId)),
    )
    .orderBy(bookings.id)
    .for("update");
}

/**
 * The authoritative in-transaction answer, derived from rows this
 * transaction already locked. A read-only check outside the transaction
 * is never a substitute for this.
 */
export function collectionHoldFromBookings(
  rows: ReadonlyArray<{ status: string }>,
): CollectionHold | null {
  return rows.some((row) => row.status === "cancelled")
    ? COLLECTION_HOLD_BOOKING_CANCELLED
    : null;
}

/**
 * Lock the linked bookings and report the hold. Used by intent
 * preparation so a held collection does not leave a prepared intent
 * behind; the payment commit still re-checks under its own row locks.
 */
export async function lockAndReadInvoiceCollectionHold(
  tx: TenantTx,
  tenantId: TenantId,
  invoiceId: string,
): Promise<CollectionHold | null> {
  return collectionHoldFromBookings(
    await lockInvoiceBookingsInTx(tx, tenantId, invoiceId),
  );
}
