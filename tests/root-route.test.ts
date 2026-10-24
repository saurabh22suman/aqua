import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPS_ROOT, TENANT_ROOT, rootDestinationFor } from "@/lib/root-route";
import type { SessionResolution } from "@/db/platform";

// The bare domain has to open the RIGHT app: the tenant surface on
// the tenant apex, the platform surface on the platform host. Before
// app/page.tsx existed, "/" was a 404 on both hosts — the bare domain
// was simply broken.
//
// These tests pin the decision itself. The route (app/page.tsx) is a
// thin adapter over it: it supplies the Host header and the session
// resolution and redirects to whatever this returns.
//
// The host boundary is the security-relevant part, so it is asserted
// directly: the tenant apex must NEVER resolve to /ops, and the
// platform host must NEVER resolve to a tenant path.

const PLATFORM_HOST = "aquaops.preprabbit.in";
const APEX_HOST = "aqua.preprabbit.in";

describe("lib/root-route", () => {
  beforeEach(() => {
    vi.stubEnv("OPS_HOST", PLATFORM_HOST);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("opens the platform app on the platform host", () => {
    expect(rootDestinationFor(PLATFORM_HOST, { kind: "none" })).toBe(OPS_ROOT);
    expect(rootDestinationFor(PLATFORM_HOST, { kind: "ok", path: "/owner" })).toBe(
      OPS_ROOT,
    );
  });

  it("opens the tenant sign-in on the apex when nobody is signed in", () => {
    expect(rootDestinationFor(APEX_HOST, { kind: "none" })).toBe(TENANT_ROOT);
  });

  it("opens the signed-in user's own home on the apex", () => {
    expect(rootDestinationFor(APEX_HOST, { kind: "ok", path: "/owner" })).toBe("/owner");
    expect(rootDestinationFor(APEX_HOST, { kind: "ok", path: "/coach" })).toBe("/coach");
  });

  it("sends a signed-out or blocked session to the sign-in door", () => {
    // 'suspended' (the club is paused) and 'none' (no active
    // membership) are explained by the login form — the same place
    // that explains them after a failed sign-in.
    expect(rootDestinationFor(APEX_HOST, { kind: "suspended", tenantSlugs: ["a"] })).toBe(
      TENANT_ROOT,
    );
    expect(rootDestinationFor(APEX_HOST, { kind: "none" })).toBe(TENANT_ROOT);
  });

  it("ignores a role home path the apex does not serve", () => {
    // A role's home_path is tenant-customisable. If it names a path
    // the apex does not serve — a platform path, or a path that does
    // not exist — the visitor must land on the sign-in door, which the
    // apex always serves, rather than on a 404.
    expect(rootDestinationFor(APEX_HOST, { kind: "ok", path: "/ops" })).toBe(TENANT_ROOT);
    expect(rootDestinationFor(APEX_HOST, { kind: "ok", path: "/owner/members" })).toBe(
      "/owner/members",
    );
    expect(rootDestinationFor(APEX_HOST, { kind: "ok", path: "/nowhere" })).toBe(TENANT_ROOT);
  });

  it("never sends the tenant apex to the platform app", () => {
    // The boundary in one assertion: whatever the session says, the
    // tenant host must not resolve to /ops.
    const sessions: SessionResolution[] = [
      { kind: "none" },
      { kind: "ok", path: "/ops" },
      { kind: "suspended", tenantSlugs: ["a"] },
    ];
    for (const session of sessions) {
      expect(rootDestinationFor(APEX_HOST, session)).not.toBe(OPS_ROOT);
    }
  });

  it("never sends the platform host to a tenant path", () => {
    expect(rootDestinationFor(PLATFORM_HOST, { kind: "ok", path: "/owner" })).not.toBe(
      "/owner",
    );
    expect(rootDestinationFor(PLATFORM_HOST, { kind: "none" })).not.toBe(TENANT_ROOT);
  });

  it("treats an unknown host as the tenant apex", () => {
    // An unrecognised host is the apex's problem, not the platform's:
    // it must never be handed the platform app.
    expect(rootDestinationFor("example.test", { kind: "none" })).toBe(TENANT_ROOT);
    expect(rootDestinationFor(null, { kind: "none" })).toBe(TENANT_ROOT);
  });
});
