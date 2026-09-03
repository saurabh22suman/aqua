import {
  listPlatformActivity,
  listKnownActions,
  type PlatformActivityFilter,
  type PlatformActivityRow,
} from "@/db/platform-activity";

// Phase 3.9 — platform activity log action. Platform-side,
// gated by platformAuthStatusAction (the same pattern as 1.6 /
// 1.7 / 1.8 — operator must have passed 2FA).

const authGate = async () => {
  const mod = await import("@/lib/actions/platform-auth");
  return mod.platformAuthStatusAction();
};

export async function listPlatformActivityAction(
  rawFilter: PlatformActivityFilter,
): Promise<{ rows: PlatformActivityRow[]; total: number }> {
  const status = await authGate();
  if (status.kind !== "authenticated") {
    throw new Error("Your session has expired. Sign in again.");
  }
  return listPlatformActivity(rawFilter);
}

export async function listKnownActionsAction(): Promise<string[]> {
  const status = await authGate();
  if (status.kind !== "authenticated") {
    throw new Error("Your session has expired. Sign in again.");
  }
  return listKnownActions();
}
