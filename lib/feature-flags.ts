// Off by default. The offline write path has a known bug (issue #4):
// mark() fires enqueueMark() inside a detached, unawaited promise, and
// idb.ts's tx() resolves before the underlying IndexedDB transaction
// actually commits — together, a mark can be lost before it is durably
// queued. Do not flip this on until that has its own fix with a
// regression test proving it. Read directly from process.env, not
// lib/env.ts's schema: an unset value means "off", which is the safe
// default, not a misconfiguration to fail loudly on.
export const OFFLINE_SYNC_ENABLED = process.env.OFFLINE_SYNC_ENABLED === "true";
