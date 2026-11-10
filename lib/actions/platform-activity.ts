import {
  listPlatformActivity,
  listKnownActions,
  type PlatformActivityFilter,
  type PlatformActivityRow,
} from "@/db/platform-activity";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";

// Phase 3.9 — platform activity log action. Platform-side,
// gated by platformAuthStatusAction (the same pattern as 1.6,
// 1.7, 1.8 — operator must have passed 2FA).

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
  // The activity read is ONE operation. It reads the UNINSTRUMENTED
  // reader, so querying the activity view never calls the instrumented
  // reader recursively and never chases its own new event: the snapshot
  // is taken before this read's own event is written.
  const result = await runOpsGlobalRead("activity.list", () =>
    listPlatformActivity(rawFilter),
  );
  if (result === null) {
    throw new Error("Your session has expired. Sign in again.");
  }
  return result;
}

export async function listKnownActionsAction(): Promise<string[]> {
  const status = await authGate();
  if (status.kind !== "authenticated") {
    throw new Error("Your session has expired. Sign in again.");
  }
  const result = await runOpsGlobalRead("activity.actions.list", () =>
    listKnownActions(),
  );
  if (result === null) {
    throw new Error("Your session has expired. Sign in again.");
  }
  return result;
}
