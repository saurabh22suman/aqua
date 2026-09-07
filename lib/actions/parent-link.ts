"use server";

import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import { signParentLinkToken } from "@/lib/services/parent-link";
import { withTenant } from "@/db/tenant";
import { auditLog } from "@/db/schema/audit";
import { staff } from "@/db/schema/staff";

// C-45 — issue a parent-page link for a specific member. Owner/admin
// only — a coach, receptionist, parent, etc. cannot mint these URLs
// (the surface reveals children's data, the smallest blast radius
// goes through the most-trusted staff).
//
// The token itself is signed with PARENT_LINK_SECRET and is valid for
// 7 days. The action returns the FULL URL (origin + path) so the UI
// can hand it straight to the operator — the secret never leaves the
// server, the token never appears in audit logs. The audit row
// records: who issued (user id + staff id when one exists), for
// whom (member id), when, and when it expires — never the token.

const inputSchema = z.object({
  memberId: z.string().uuid(),
});

export type IssueParentLinkResult =
  | { kind: "ok"; url: string; expiresAt: string }
  | { kind: "error"; code: "invalid" | "unauthorized"; message: string };

export async function issueParentLinkAction(
  raw: unknown,
): Promise<IssueParentLinkResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Member id required." };
  }
  const ctx = await requireDefaultCtx();
  try {
    assertManagement(ctx);
  } catch {
    // assertManagement throws on a non-management role; surface
    // the same shape the type allows so the UI can render an
    // inline pill without the call landing as an unhandled
    // exception in the Server Action handler.
    return { kind: "error", code: "unauthorized", message: "You cannot issue parent links." };
  }

  const { token, claims } = signParentLinkToken({
    tenantId: ctx.tenantId,
    personId: parsed.data.memberId,
  });

  // J4 audit — record who issued, for whom, when, and when the
  // link stops being valid. The token itself is the secret; only
  // its expiry is durable (the iat+ttl that produced it). The
  // "after" JSONB carries user_id + staff_id (when one exists) +
  // member_id + iat + exp + scope so an investigator can answer
  // "who issued link X, to whom, until when" without ever
  // recovering the token. (No row exists for "the token"; the
  // only place a token lives is the URL the operator copied out
  // of the form.)
  //
  // The actorId column references users(id) — the durable auth
  // identity. The staff id (when one exists for that user) is
  // denormalised into the JSONB because it's the natural unit
  // "who works here" reads use.
  //
  // The insert runs inside withTenant() so the row is tenant-
  // scoped and RLS picks it up. The permission check above has
  // already verified the caller; we don't recheck here.
  await withTenant(ctx.tenantId, async (tx) => {
    const staffRow = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(
        and(
          eq(staff.tenantId, ctx.tenantId),
          eq(staff.userId, ctx.userId),
          isNull(staff.deletedAt),
        ),
      )
      .limit(1);
    const staffId = staffRow[0]?.id ?? null;

    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "parent_link.issue",
      entityType: "parent_link",
      entityId: parsed.data.memberId,
      before: null,
      after: {
        memberId: parsed.data.memberId,
        userId: ctx.userId,
        staffId,
        issuedAt: new Date(claims.iat * 1000).toISOString(),
        expiresAt: new Date(claims.exp * 1000).toISOString(),
        scope: claims.scope,
      },
      ip: null,
    });
  });

  return {
    kind: "ok",
    url: `/p/${token}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}
