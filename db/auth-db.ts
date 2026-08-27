// The one sanctioned handle for wiring better-auth's drizzle adapter.
// better-auth needs the raw db instance at construction time; every query
// it actually executes is scoped per call site via withPlatform() (see
// lib/auth/server.ts, app/api/auth/[...all]/route.ts — each wrap is
// commented load-bearing). This is the only file outside db/client.ts
// itself that may hold the raw handle; everything else reaches data
// through withTenant()/withUser()/withPlatform() in db/tenant.ts and
// db/scope.ts. See db/CLAUDE.md.
export { db } from "./client";
