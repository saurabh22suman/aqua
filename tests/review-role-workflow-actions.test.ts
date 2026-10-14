import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";

// R02/R07/R08 (docs/audits/2026-10-13-role-workflow-audit.md) — direct
// action and routing contracts that do not need a database:
//   R02  curriculum editing rides levels.write, not settings.manage,
//        and delegation needs settings.manage;
//   R07  the member-id-card action now has its documented members.read
//        gate;
//   R08  the worker surface and middleware allowlist.
const mocks = vi.hoisted(() => ({ ctx: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: mocks.ctx,
  NotFoundError: class extends Error {},
}));

const tenantId = asTenantId(randomUUID());
const userId = asUserId(randomUUID());

function ctxWith(permissions: string[], roleKey = "admin") {
  return {
    tenantId,
    userId,
    roleKey,
    allLocations: true,
    locationIds: [],
    permissions: new Set(permissions),
  };
}

describe("R02 curriculum permission contract", () => {
  it("maps ladder edits to levels.write and delegation to settings.manage", async () => {
    const { ACTION_PERMISSION_MAP } = await import("@/lib/auth/action-permissions");
    expect(ACTION_PERMISSION_MAP.updateSkillLevelAction).toBe("levels.write");
    expect(ACTION_PERMISSION_MAP.updateSkillNodeAction).toBe("levels.write");
  });

  it("templates: curriculum_lead carries levels.write; coach does not", async () => {
    const { roleTemplatePermissionKeys } = await import("@/lib/services/roles");
    const lead = roleTemplatePermissionKeys("curriculum_lead");
    const coach = roleTemplatePermissionKeys("coach");
    expect(lead?.has("levels.write")).toBe(true);
    expect(lead?.has("levels.assess")).toBe(true);
    expect(coach?.has("levels.write")).toBe(false);
    expect(coach?.has("levels.assess")).toBe(true);
  });

  it("rejects a broad settings.manage holder without levels.write at the action", async () => {
    mocks.ctx.mockResolvedValue(ctxWith(["settings.manage", "levels.read"]));
    const { updateSkillLevelAction } = await import("@/lib/actions/skill-ladder");
    await expect(
      updateSkillLevelAction({ nodeId: randomUUID(), name: "Renamed" }),
    ).rejects.toThrow(/levels.write/);
  });

  it("rejects curriculum-lead designation without settings.manage", async () => {
    mocks.ctx.mockResolvedValue(ctxWith(["staff.read"], "coach"));
    const { setStaffCurriculumLeadAction } = await import("@/lib/actions/curriculum-lead");
    await expect(
      setStaffCurriculumLeadAction({ staffId: randomUUID(), enabled: true }),
    ).rejects.toThrow(/settings.manage/);
  });
});

describe("R07 member id-card permission check", () => {
  it("rejects a caller without members.read", async () => {
    mocks.ctx.mockResolvedValue(ctxWith(["attendance.mark", "staff.self"], "worker"));
    const { getMemberIdCardContextAction } = await import("@/lib/actions/people");
    await expect(getMemberIdCardContextAction()).rejects.toThrow(/members.read/);
  });
});

describe("R08 worker surface and middleware", () => {
  it("maps worker to its own surface and denies parent/coach/owner", async () => {
    const {
      surfaceForRole,
      canAccessSurface,
      SURFACE_WORKER,
      SURFACE_PARENT,
      SURFACE_COACH,
      SURFACE_OWNER,
      SURFACE_RECEPTION,
    } = await import("@/lib/auth/surface-access");
    expect(surfaceForRole("worker")).toBe(SURFACE_WORKER);
    expect(canAccessSurface("worker", SURFACE_WORKER)).toBe(true);
    expect(canAccessSurface("worker", SURFACE_PARENT)).toBe(false);
    expect(canAccessSurface("worker", SURFACE_COACH)).toBe(false);
    expect(canAccessSurface("worker", SURFACE_OWNER)).toBe(false);
    // Cross-role denial: nobody else gains the worker surface.
    for (const role of ["coach", "owner", "admin", "accountant", "receptionist", "curriculum_lead"]) {
      expect(canAccessSurface(role, SURFACE_WORKER)).toBe(false);
    }
    expect(canAccessSurface("curriculum_lead", SURFACE_COACH)).toBe(true);
    expect(canAccessSurface("coach", SURFACE_RECEPTION)).toBe(false);
  });

  it("middleware allows /worker (and its subtree) but not lookalike prefixes", async () => {
    const { middleware } = await import("@/middleware");
    const { NextRequest } = await import("next/server");
    const run = (path: string) =>
      middleware(
        new NextRequest(`http://academy.localhost${path}`, {
          headers: { host: "academy.localhost" },
        }),
      );
    expect(run("/worker").status).toBe(200);
    expect(run("/worker/anything").status).toBe(200);
    expect(run("/workerside").status).toBe(404);
    expect(run("/ops").status).toBe(404);
    expect(run("/parent").status).toBe(200);
  });
});
