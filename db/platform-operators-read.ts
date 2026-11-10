import { asc, desc, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import { platformSessions, platformUsers } from "./schema";

export const OPERATOR_LIST_LIMIT = 50;
export const OPERATOR_SESSION_LIMIT = 100;

import type { OperatorRole, OperatorStatus } from "./platform-operators-shared";
export type { OperatorRole, OperatorStatus } from "./platform-operators-shared";

/** One operator account, as the console may show it. */
export type OperatorAccountRow = {
  id: string;
  name: string;
  email: string;
  role: OperatorRole;
  status: OperatorStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
};

/**
 * One operator session, as the console may show it.
 *
 * `state` is computed here, from the stored expiry, so an expired
 * session is EXPIRED and is never shown as live. Only a live session
 * can be ended — and the write enforces that too, so the two agree.
 */
export type OperatorSessionRow = {
  id: string;
  operatorId: string;
  state: "active" | "expired";
  secondFactorPassed: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type OperatorAccountList = {
  rows: OperatorAccountRow[];
  /** The true number of operator accounts, even when the list is bounded. */
  total: number;
  limit: number;
};

export type OperatorSessionList = {
  rows: OperatorSessionRow[];
  /** Every session of the listed operators, even when the list is bounded. */
  total: number;
  /** The true session count PER OPERATOR, so a card can state its own. */
  countsByOperator: Record<string, number>;
  limit: number;
};

/** The operator accounts, bounded, with the true total. */
export async function listOperatorAccounts(
  limit: number = OPERATOR_LIST_LIMIT,
): Promise<OperatorAccountList> {
  const safeLimit = Math.min(Math.max(limit, 1), OPERATOR_LIST_LIMIT);
  return withPlatform(async () => {
    const totals = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(platformUsers);
    const rows = await db
      .select({
        id: platformUsers.id,
        name: platformUsers.name,
        email: platformUsers.email,
        role: platformUsers.role,
        status: platformUsers.status,
        lastLoginAt: platformUsers.lastLoginAt,
        createdAt: platformUsers.createdAt,
      })
      .from(platformUsers)
      .orderBy(asc(platformUsers.role), asc(platformUsers.name))
      .limit(safeLimit);
    return {
      rows: rows.map((row) => ({
        ...row,
        role: row.role as OperatorRole,
        status: row.status as OperatorStatus,
      })),
      total: totals[0]?.count ?? 0,
      limit: safeLimit,
    };
  });
}

/**
 * The sessions of the named operators, bounded, with the true totals.
 *
 * An expired session is returned and marked expired: the console has
 * to be able to say that a session ended as well as that one is live.
 */
export async function listOperatorSessions(
  operatorIds: string[],
  limit: number = OPERATOR_SESSION_LIMIT,
): Promise<OperatorSessionList> {
  const safeLimit = Math.min(Math.max(limit, 1), OPERATOR_SESSION_LIMIT);
  if (operatorIds.length === 0) {
    return { rows: [], total: 0, countsByOperator: {}, limit: safeLimit };
  }
  const now = Date.now();
  return withPlatform(async () => {
    const totals = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(platformSessions)
      .where(inArray(platformSessions.userId, operatorIds));
    const grouped = await db
      .select({
        operatorId: platformSessions.userId,
        count: sql<number>`count(*)::int`,
      })
      .from(platformSessions)
      .where(inArray(platformSessions.userId, operatorIds))
      .groupBy(platformSessions.userId);
    const rows = await db
      .select({
        id: platformSessions.id,
        operatorId: platformSessions.userId,
        secondFactorPassed: platformSessions.secondFactorPassed,
        createdAt: platformSessions.createdAt,
        lastSeenAt: platformSessions.lastSeenAt,
        expiresAt: platformSessions.expiresAt,
      })
      .from(platformSessions)
      .where(inArray(platformSessions.userId, operatorIds))
      .orderBy(desc(platformSessions.lastSeenAt))
      .limit(safeLimit);
    const countsByOperator: Record<string, number> = {};
    for (const row of grouped) countsByOperator[row.operatorId] = row.count;
    return {
      rows: rows.map((row) => ({
        ...row,
        state: row.expiresAt.getTime() > now ? "active" : "expired",
      })),
      total: totals[0]?.count ?? 0,
      countsByOperator,
      limit: safeLimit,
    };
  });
}
