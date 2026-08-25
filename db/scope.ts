import { AsyncLocalStorage } from "node:async_hooks";

export type Scope =
  | { kind: "tenant"; tenantId: string }
  | { kind: "platform" };

export const scopeStorage = new AsyncLocalStorage<Scope>();

export async function withPlatform<T>(fn: () => Promise<T>): Promise<T> {
  return scopeStorage.run({ kind: "platform" }, fn);
}

export function currentScope(): Scope | undefined {
  return scopeStorage.getStore();
}
