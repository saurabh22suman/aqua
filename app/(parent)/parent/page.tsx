import { notFound } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, SURFACE_PARENT } from "@/lib/auth/surface-access";
import { ParentLinkExplainer } from "@/components/parent-link-explainer";

// W1-3 (docs/role-surfaces-plan.md) — parents do not have accounts
// (scope §3.3: no app, no install); their real surface is the signed
// /p/[token] link the club shares on WhatsApp. This page explains
// that instead of showing a dead end.
//
// P-D3 (2026-09-13 audit): the role gate used to live in the group
// layout, so a cross-surface visitor got the global generic 404. The
// page owns the check now (the D2 page-guard principle), which lets
// not-found.tsx in this same segment render the parent-specific
// explainer at a 404 status. Workers are the allowed role here.
export default async function ParentPage() {
  const ctx = await requireDefaultCtx();
  if (!canAccessSurface(ctx.roleKey, SURFACE_PARENT)) {
    notFound();
  }
  return <ParentLinkExplainer />;
}
