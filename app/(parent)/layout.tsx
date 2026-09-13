import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";

// See app/(owner)/layout.tsx for the role-gating rationale. The
// /parent route group is a stub today (S5 -- the real parent
// surface is /p/[token], outside this gate). Workers also land
// here as a placeholder home until a worker surface exists
// (scope §195).
//
// D2 (page-guard scan): layouts no longer authorize surface access
// -- pages do. The role check lives in app/(parent)/parent/page.tsx
// so its 404 can render the parent-specific not-found boundary
// (P-D3, 2026-09-13 audit). This layout only handles the
// unauthenticated redirect.
export default async function ParentLayout({ children }: { children: ReactNode }) {
  try {
    await requireDefaultCtx();
  } catch {
    redirect("/login");
  }
  return <div className="min-h-dvh">{children}</div>;
}
