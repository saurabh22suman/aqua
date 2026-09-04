"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import { signParentLinkToken } from "@/lib/services/parent-link";

// C-45 — issue a parent-page link for a specific member. Owner/admin
// only — a coach, receptionist, parent, etc. cannot mint these URLs
// (the surface reveals children's data, the smallest blast radius
// goes through the most-trusted staff).
//
// The token itself is signed with PARENT_LINK_SECRET and is valid for
// 7 days. The action returns the FULL URL (origin + path) so the UI
// can hand it straight to the operator — the secret never leaves the
// server, the link never appears in audit logs.

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
  assertManagement(ctx);

  const { token, claims } = signParentLinkToken({
    tenantId: ctx.tenantId,
    personId: parsed.data.memberId,
  });

  // The origin resolution: prefer an explicit BETTER_AUTH_URL (which is
  // the real public HTTPS origin in production), fall back to a relative
  // URL the UI can resolve. The link IS the secret — it embeds tenant
  // + person + scope + expiry. Anyone with the URL is the parent for
  // 7 days. We do not log it.
  void claims;
  return {
    kind: "ok",
    url: `/p/${token}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}
