import { notFound } from "next/navigation";
import { requireDefaultCtx, type Ctx } from "./context";
import {
  canAccessSurface,
  type TenantSurface,
} from "./surface-access";

// D2 — page-level surface guard.
//
// The audit found: app/(owner)/layout.tsx (and the coach /
// reception equivalents) was the only authorization gate between
// a cross-surface role and the page's data. A client-supplied
// `Next-Router-State-Tree` claiming "(owner)" is mounted tells
// Next.js the layout is already rendered, so the layout's
// server component is skipped on the RSC payload — `canAccessSurface`
// never runs and the page returns protected data.
//
// The new rule, recorded in CLAUDE.md: layouts are for UI only.
// Every page and every server action authorizes itself. This
// module is the page guard. Every page.tsx under a tenant route
// group calls `requireSurface(SURFACE_X)` as its first
// statement, BEFORE any data fetch. The action layer is the
// parallel fix in lib/actions/* (every 'use server' function
// calls requirePermission; see tests/scanner-fixtures/ for the
// companion scan).
//
// `notFound()` is the right answer for a wrong-surface page:
// the URL looks like a made-up path the user never had, not
// "the page exists but your role can't see it". The probe the
// attack test runs is the 200-with-data leak; a 404 from the page
// guard is indistinguishable from a 404 from a typo and the
// auditor has nothing to learn.
//
// `requireSurface` does NOT throw — it calls notFound(), which
// Next.js turns into a thrown NEXT_NOT_FOUND. Tests that want
// to assert "wrong role → notFound" mock notFound with a
// sentinel error (see tests/tier1/nav-feature-gating.test.ts
// for the pattern; the role-bypass e2e uses the actual 404
// response).
export async function requireSurface(surface: TenantSurface): Promise<Ctx> {
  const ctx = await requireDefaultCtx();
  if (!canAccessSurface(ctx.roleKey, surface)) {
    notFound();
  }
  return ctx;
}

// Surface-specific shortcuts — one per role route group. Calling
// code reads the surface name in plain English instead of
// passing the SURFACE_* constant, which keeps the page guard
// self-documenting at the call site.
export const requireOwner = (): Promise<Ctx> => requireSurface("owner" as TenantSurface);
export const requireCoach = (): Promise<Ctx> => requireSurface("coach" as TenantSurface);
export const requireReception = (): Promise<Ctx> => requireSurface("reception" as TenantSurface);