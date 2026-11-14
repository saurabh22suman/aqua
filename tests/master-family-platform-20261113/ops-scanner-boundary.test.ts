import { expect, it } from "vitest";
import { scanOpsActions, scanPlatformAdminGuards } from "@/scripts/lib/ops-action-scan";
import * as opsScanner from "@/scripts/lib/ops-action-scan";
import { readFileSync } from "node:fs";
const strictScan = (source: string, file: string) => {
  const scanner = opsScanner as typeof opsScanner & { scanCheckedPlatformAdminGuards?: typeof scanPlatformAdminGuards };
  return (scanner.scanCheckedPlatformAdminGuards ?? scanPlatformAdminGuards)(source, file);
};
const path = "lib/actions/platform-synthetic.ts";
it("does not count guards hidden inside a never-called nested function", () => {
  const code = `export async function unsafe() { async function unused() { await opsAction(); await requireOpsAdminAction(); } return mutate(); }`;
  expect(scanOpsActions(code, path).map((v) => v.functionName)).toEqual(["unsafe"]);
  expect(scanPlatformAdminGuards(code, path).map((v) => v.functionName)).toEqual(["unsafe"]);
});
it("recognizes direct calls within the exported function body", () => {
  const code = `export async function safe() { await requireOpsAdminAction(); return opsAction(async () => mutate()); }`;
  expect(scanOpsActions(code, path)).toEqual([]);
  expect(scanPlatformAdminGuards(code, path)).toEqual([]);
});
it("flags exported arrow actions rather than silently skipping them", () => {
  const code = `export const unsafeArrow = async () => mutate();`;
  expect(scanOpsActions(code, path).map((v) => v.functionName)).toEqual(["unsafeArrow"]);
  expect(scanPlatformAdminGuards(code, path).map((v) => v.functionName)).toEqual(["unsafeArrow"]);
});
it.each([
  ["comment", `// requireOpsAdminAction()\nexport async function unsafe() { return mutate(); }`],
  ["unawaited", `import { requireOpsAdminAction } from "@/lib/actions/platform-auth"; export async function unsafe() { const gate = requireOpsAdminAction(); if (gate.kind !== "ok") return; return mutate(); }`],
  ["unchecked", `import { requireOpsAdminAction } from "@/lib/actions/platform-auth"; export async function unsafe() { await requireOpsAdminAction(); return mutate(); }`],
  ["wrong import", `import { requireOpsAdminAction } from "./fake"; export async function unsafe() { const gate = await requireOpsAdminAction(); if (gate.kind !== "ok") return; return mutate(); }`],
  ["no denial return", `import { requireOpsAdminAction } from "@/lib/actions/platform-auth"; export async function unsafe() { const gate = await requireOpsAdminAction(); if (gate.kind !== "ok") log(); return mutate(); }`],
  ["service in denial branch", `import { requireOpsAdminAction } from "@/lib/actions/platform-auth"; export async function unsafe() { const gate = await requireOpsAdminAction(); if (gate.kind !== "ok") { await mutate(); return; } return mutate(); }`],
  ["late check", `import { requireOpsAdminAction } from "@/lib/actions/platform-auth"; export async function unsafe() { const gate = await requireOpsAdminAction(); mutate(); if (gate.kind !== "ok") return; }`],
  ["service before guard", `import { requireOpsAdminAction } from "@/lib/actions/platform-auth"; export async function unsafe() { mutate(); const gate = await requireOpsAdminAction(); if (gate.kind !== "ok") return; }`],
  ["shadowed guard", `import { requireOpsAdminAction } from "@/lib/actions/platform-auth"; export async function unsafe(requireOpsAdminAction: any) { const gate = await requireOpsAdminAction(); if (gate.kind !== "ok") return; return mutate(); }`],
])("does not treat %s as checked admin authority", (_label, code) => {
  expect(strictScan(code, path).map((v) => v.functionName)).toEqual(["unsafe"]);
});
it("flags a mutation added to a reviewed platform read and a forged read boundary", () => {
  const file = "lib/actions/platform-jobs.ts";
  const source = readFileSync(file, "utf8");
  expect(scanOpsActions(source, file)).toEqual([]);
  const changed = source.replace('const result = await runOpsGlobalRead("job.dead_letter.list"', 'await mutate();\n  const result = await runOpsGlobalRead("job.dead_letter.list"');
  expect(changed).not.toBe(source);
  expect(scanOpsActions(changed, file).map((v) => v.functionName)).toContain("listDeadLetterJobsAction");
  const forged = source.replace('"@/lib/auth/ops-operation"', '"@/lib/fake"');
  expect(scanOpsActions(forged, file).map((v) => v.functionName)).toContain("listDeadLetterJobsAction");
});
it("accepts an imported awaited admin gate only after a terminating denial check", () => {
  const code = `import { requireOpsAdminAction } from "@/lib/actions/platform-auth"; export async function safe() { const gate = await requireOpsAdminAction(); if (gate.kind !== "ok") { return { error: true }; } return mutate(); }`;
  expect(strictScan(code, path)).toEqual([]);
});
it.each([
  ["platform-failed-notifications", ["listFailedMessagesAction", "retryFailedNotificationAction", "dismissFailedNotificationAction"]],
  ["platform-jobs", ["listDeadLetterJobsAction"]],
  ["platform-notifications", ["listNotificationsNeedingAttentionAction", "resendUnknownNotificationAction", "closeUnknownNotificationAction"]],
  ["platform-operators-read", ["listOperatorAccountsAction", "listOperatorSessionsAction"]],
  ["platform-operators-write", ["revokeOperatorSessionAction", "revokeAllOperatorSessionsAction", "setOperatorRoleAction", "setOperatorStatusAction"]],
  ["platform-tenant-plan", ["assignTenantPlanAction"]],
  ["platform-tenant-trial", ["setTenantTrialDeadlineAction"]],
])("recognizes the reviewed real admin gates in %s", (name, actions) => {
  const file = `lib/actions/${name}.ts`;
  const source = readFileSync(file, "utf8");
  const violations = strictScan(source, file).map((v) => v.functionName);
  for (const action of actions) expect(violations).not.toContain(action);
  const forged = source.replace('"@/lib/actions/platform-auth"', '"@/lib/actions/fake"');
  for (const action of actions) expect(strictScan(forged, file).map((v) => v.functionName)).toContain(action);
  const firstGuard = source.indexOf("const gate = await requireOpsAdminAction()");
  const fallbackGuard = source.indexOf("const status = await requireOpsAdminAction()");
  const index = firstGuard >= 0 ? firstGuard : fallbackGuard;
  expect(index).toBeGreaterThan(-1);
  const earlyService = source.slice(0, index) + "await mutate();\n  " + source.slice(index);
  expect(strictScan(earlyService, file).map((v) => v.functionName)).toContain(actions[0]);
});
