import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, SURFACE_PARENT } from "@/lib/auth/surface-access";

// See app/(owner)/layout.tsx for the role-gating rationale. The
// /parent route group is a stub today (S5 -- the real parent
// surface is /p/[token], outside this gate). Workers also land
// here as a placeholder home until a worker surface exists
// (scope §195). The role-to-surface map in lib/auth/surface-access
// keeps both behind the same gate; the page inside (still an
// "h1 Parent" stub) renders for either role, and the matrix
// test pins this.
export default async function ParentLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireDefaultCtx();
  } catch {
    redirect("/login");
  }
  if (!canAccessSurface(ctx.roleKey, SURFACE_PARENT)) {
    notFound();
  }
  return <div className="min-h-dvh">{children}</div>;
}
