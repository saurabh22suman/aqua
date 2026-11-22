// Off by default. The offline write path has a known bug (issue #4):
// mark() fires enqueueMark() inside a detached, unawaited promise, and
// idb.ts's tx() resolves before the underlying IndexedDB transaction
// actually commits — together, a mark can be lost before it is durably
// queued. Do not flip this on until that has its own fix with a
// regression test proving it. Read directly from process.env, not
// lib/env.ts's schema: an unset value means "off", which is the safe
// default, not a misconfiguration to fail loudly on.
export const OFFLINE_SYNC_ENABLED = process.env.OFFLINE_SYNC_ENABLED === "true";

// F05 (human decision, 29 October 2026) — the six CORE modules are
// MANDATORY: every tenant has them, whatever its plan or any override
// says.
//
// The RUNTIME policy is lib/auth/permission.ts's ALWAYS_ON_MODULES. That
// file is a protected path this work does not edit, and its set is
// module-private. The operator-facing surface needs the same six keys so
// it stops offering a switch the runtime ignores, so they are declared
// here and pinned to the runtime by an agent-owned regression
// (tests/staging-blockers-20261029/b-isolation/b-08-ops-core-module-switch.test.tsx)
// that derives the runtime's always-on set through requirePermission
// itself: the set of features the Ops entitlement editor gives no switch
// must equal it exactly — no more, no less.
//
// A stored override for a core module is never deleted. The runtime
// ignores it; the console shows the module as included.
export const MANDATORY_MODULES = [
  "members",
  "attendance",
  "programs",
  "enquiries",
  "staff",
  "settings",
] as const;

export type MandatoryModule = (typeof MANDATORY_MODULES)[number];

export function isMandatoryModule(key: string): boolean {
  return (MANDATORY_MODULES as readonly string[]).includes(key);
}
