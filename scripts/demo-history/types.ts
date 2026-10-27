import type { PaymentMethodKey } from "@/lib/money/payment-groups";

// The plan's shape. One snapshot in, one plan out — the planner is pure
// (no clock beyond the snapshot's anchor date, no I/O, no randomness
// beyond a deterministic hash), so a test can pin every boundary and a
// reviewer can read the whole history without touching a database.
//
// Money is integer paise everywhere. Dates are the tenant's local
// calendar dates (Asia/Kolkata for the demo tenants); instants are ISO
// strings in UTC, which is what the timestamptz columns store.

export type SnapshotMember = {
  id: string;
  code: string;
  status: "trial" | "active" | "paused" | "lapsed" | "left";
  locationId: string;
};

export type SnapshotBatch = {
  id: string;
  name: string;
  /** 0 = Sunday. */
  daysOfWeek: number[];
  /** Wall time, "HH:MM" or "HH:MM:SS". */
  startTime: string;
  endTime: string;
  capacity: number;
  locationId: string | null;
  coachId: string | null;
  /** Members enrolled in the batch. */
  memberIds: string[];
};

export type SnapshotPlan = {
  id: string;
  name: string;
  amountPaise: number;
  durationDays: number | null;
  kind: "duration" | "term" | "sessions";
  /** The preset template this plan was activated from, when there was one. */
  sourceShapeId: string | null;
  locationId: string;
  activityId: string | null;
  /** True when the plan does not exist yet and the generator will create it. */
  proposed: boolean;
};

export type TenantSnapshot = {
  tenantId: string;
  slug: string;
  name: string;
  timezone: string;
  /** The tenant's local today. The whole window is relative to it. */
  anchorDate: string;
  /**
   * The instant the plan is anchored to (ISO). Nothing the plan writes
   * may be dated after it: no future payment, no future mark, no future
   * enquiry. A demo that claims money already collected has not collected
   * yet is exactly the kind of fiction this tool must not produce.
   */
  nowIso: string;
  windowDays: number;
  primaryLocationId: string;
  members: SnapshotMember[];
  batches: SnapshotBatch[];
  /** Tenant holidays as local calendar dates — no session on these. */
  holidays: string[];
  plans: SnapshotPlan[];
  /** The user id payments are attributed to (the desk), when there is one. */
  receiverUserId: string | null;
};

export type PlannedSession = {
  key: string;
  batchId: string;
  batchName: string;
  date: string;
  startsAtIso: string;
  endsAtIso: string;
  markedAtIso: string;
  locationId: string | null;
  coachId: string | null;
  /** A register nobody filled in — the session happened, no marks exist. */
  unmarked: boolean;
};

export type PlannedMark = {
  key: string;
  sessionKey: string;
  /** The session's local date — the day the register belongs to. */
  sessionDate: string;
  memberId: string;
  memberCode: string;
  status: "present" | "late" | "absent";
  markedAtIso: string;
  clientId: string;
};

export type PlannedSubscription = {
  key: string;
  memberId: string;
  memberCode: string;
  planId: string;
  planName: string;
  startsOn: string;
  endsOn: string;
  status: "active" | "expired";
  amountPaise: number;
  autoRenew: boolean;
};

export type PlannedPayment = {
  key: string;
  invoiceKey: string;
  memberId: string;
  amountPaise: number;
  method: PaymentMethodKey;
  receivedAtIso: string;
  /** Cash carries no reference; every other method needs one. */
  reference: string | null;
};

export type PlannedInvoice = {
  key: string;
  subscriptionKey: string;
  memberId: string;
  memberCode: string;
  planId: string;
  planName: string;
  issuedOn: string;
  dueOn: string;
  totalPaise: number;
  paidPaise: number;
  status: "paid" | "partial" | "issued";
  description: string;
  payments: PlannedPayment[];
};

export type PlannedFollowUp = {
  key: string;
  enquiryKey: string;
  dueAtIso: string;
  doneAtIso: string | null;
  note: string;
};

export type PlannedEnquiry = {
  key: string;
  fullName: string;
  phone: string;
  source: "walk-in" | "phone" | "referral" | "online" | "other";
  stage:
    | "new"
    | "contacted"
    | "trial_scheduled"
    | "trial_completed"
    | "converted"
    | "lost";
  createdAtIso: string;
  notes: string;
  memberId: string | null;
  followUps: PlannedFollowUp[];
};

export type HistoryPlanTotals = {
  sessions: number;
  unmarkedSessions: number;
  marks: number;
  marksByStatus: Record<"present" | "late" | "absent", number>;
  subscriptions: number;
  invoices: number;
  invoicesByStatus: Record<"paid" | "partial" | "issued", number>;
  payments: number;
  paymentsPaise: number;
  paymentsByMethod: Record<PaymentMethodKey, number>;
  enquiries: number;
  followUps: number;
  daysWithPayments: number;
  daysWithoutPayments: number;
};

export type HistoryPlan = {
  window: {
    from: string;
    to: string;
    days: number;
    anchorDate: string;
    timezone: string;
  };
  sessions: PlannedSession[];
  marks: PlannedMark[];
  subscriptions: PlannedSubscription[];
  invoices: PlannedInvoice[];
  payments: PlannedPayment[];
  enquiries: PlannedEnquiry[];
  followUps: PlannedFollowUp[];
  totals: HistoryPlanTotals;
};
