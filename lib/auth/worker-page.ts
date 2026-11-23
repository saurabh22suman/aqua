import { notFound } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permission";

export async function requireWorkerPage() {
  const ctx = await requireDefaultCtx();
  if (ctx.roleKey !== "worker" || !hasPermission(ctx, "staff.self")) notFound();
  return ctx;
}
