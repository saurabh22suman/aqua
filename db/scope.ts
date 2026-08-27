import { AsyncLocalStorage } from "node:async_hooks";

export type Scope =
  | { kind: "tenant"; tenantId: string }
  | { kind: "platform" }
  | { kind: "user"; userId: string };

export const scopeStorage = new AsyncLocalStorage<Scope>();

export function currentScope(): Scope | undefined {
  return scopeStorage.getStore();
}

// withTenant and withUser each open their own transaction and set a
// Postgres session variable RLS policies branch on (app.tenant_id,
// app.user_id respectively). Nesting either inside the other — or inside
// itself — would risk both variables being visible to the same
// transaction, OR-ing their RLS policies together into a wider view than
// either mode intends on its own. withPlatform sets no such variable — it
// never calls set_config — so it is safe to nest freely in either
// direction (better-auth's own call chain does this: an outer
// withPlatform around auth.api.verifyPhoneNumber legitimately triggers an
// inner withPlatform around linkBetterAuthUser via callbackOnVerification).
const SQL_SCOPED_KINDS = new Set<Scope["kind"]>(["tenant", "user"]);

export function enterScope<T>(scope: Scope, fn: () => Promise<T>): Promise<T> {
  const existing = currentScope();
  if (existing && SQL_SCOPED_KINDS.has(scope.kind) && SQL_SCOPED_KINDS.has(existing.kind)) {
    throw new Error(
      `Cannot enter ${scope.kind} scope while already inside a ${existing.kind} scope — ` +
        `withTenant() and withUser() must not nest.`,
    );
  }
  return scopeStorage.run(scope, fn);
}

export async function withPlatform<T>(fn: () => Promise<T>): Promise<T> {
  return enterScope({ kind: "platform" }, fn);
}
