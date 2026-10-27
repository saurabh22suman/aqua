import type { TenantTx } from "@/db/tenant";
import type { TenantId } from "@/lib/ids";
import type { TenantState } from "./snapshot";
import type { HistoryPlan, TenantSnapshot } from "./types";

// The writers' shared context.
//
// One transaction, one tenant: the writers share the transaction, the
// counters and the audit buffer, and each of them owns one part of the
// history (the money, the schedule, the enquiries). The buffer exists
// because every audit row has to be written in the SAME transaction as
// the row it describes — collecting them and flushing them at the end of
// the transaction keeps that guarantee in one place.

export type AuditRow = {
  action: string;
  entityType: string;
  entityId: string | null;
  after: Record<string, unknown>;
  createdAt: Date;
};

export type WriteCounters = {
  plans: number;
  subscriptions: number;
  invoices: number;
  invoiceLines: number;
  payments: number;
  sessions: number;
  marks: number;
  enquiries: number;
  followUps: number;
  auditRows: number;
};

export type WriteExisting = {
  plans: number;
  subscriptions: number;
  invoices: number;
  payments: number;
  sessions: number;
  marks: number;
  enquiries: number;
};

export type WriteContext = {
  tx: TenantTx;
  tenantId: TenantId;
  state: TenantState;
  snapshot: TenantSnapshot;
  plan: HistoryPlan;
  counters: WriteCounters;
  existing: WriteExisting;
  audit: AuditRow[];
  /** The instant the run is anchored to. */
  nowMs: number;
};
