import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { sessionExists } from "@/lib/auth/context";

// No bottom nav here on purpose: S5 (the real parent surface — signed
// single-purpose tokens, zero-JS, no phone/OTP session at all) is RED,
// proposed but not approved. This layout exists only to close the gap
// this route group had relative to (coach)/(owner): unlike those, it
// shipped with no session gate at all. Do not add nav or UI here before
// S5 lands — that would invent the design DESIGN.md and the plan haven't
// settled yet.
export default async function ParentLayout({ children }: { children: ReactNode }) {
  if (!(await sessionExists())) redirect("/login");
  return <div className="min-h-dvh">{children}</div>;
}
