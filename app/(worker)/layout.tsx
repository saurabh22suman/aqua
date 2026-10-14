import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";

// A05 — the worker route group's frame. Like the other surfaces'
// layouts, this only steers the unauthenticated visitor to /login;
// the page authorizes itself (D2 page-guard principle).
export default async function WorkerLayout({ children }: { children: ReactNode }) {
  try {
    await requireDefaultCtx();
  } catch {
    redirect("/login");
  }
  return <div className="min-h-dvh">{children}</div>;
}
