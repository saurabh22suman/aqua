import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { checkedAlternatePrincipal as check } from "./alternate-principal-proposal-helper";
const cases = [
  ["lib/actions/announcements.ts", "markNotificationReadAction", "return markNotificationRead(ctx, parsed.data.notificationId);"],
  ["lib/actions/self-notifications.ts", "markSelfNotificationAction", "if (!resolver) notFound();"],
  ["lib/actions/club-selection.ts", "selectClubAction", "if (!selected) return { error: \"This club is no longer available. Refresh and choose again.\" };"],
] as const;

it.each(cases)("recognizes the exact reviewed alternate authority %s#%s", (path, action) => {
  expect(check(path, action, readFileSync(path, "utf8"))).toBe(true);
});
it.each(cases)("rejects a removed service or denial boundary in %s#%s", (path, action, boundary) => {
  const source = readFileSync(path, "utf8");
  expect(source).toContain(boundary);
  expect(check(path, action, source.replace(boundary, "return;"))).toBe(false);
});
it("does not accept the same action name under another path or a forged guard import", () => {
  const path = "lib/actions/self-notifications.ts";
  const source = readFileSync(path, "utf8");
  expect(check("lib/actions/other.ts", "markSelfNotificationAction", source)).toBe(false);
  expect(check(path, "markSelfNotificationAction", source.replace('"@/lib/auth/self-scope"', '"@/lib/fake"'))).toBe(false);
});
it("rejects a service call moved before the staff authority lookup", () => {
  const path = "lib/actions/announcements.ts";
  const source = readFileSync(path, "utf8");
  const authority = "  const ctx = await requireDefaultCtx();\n  return markNotificationRead(ctx, parsed.data.notificationId);";
  expect(source).toContain(authority);
  expect(check(path, "markNotificationReadAction", source.replace(authority, "  await markNotificationRead({} as never, parsed.data.notificationId);\n" + authority))).toBe(false);
});
it("rejects a weakened UUID schema", () => {
  const path = "lib/actions/announcements.ts";
  const source = readFileSync(path, "utf8");
  expect(check(path, "markNotificationReadAction", source.replace('notificationId: z.string().uuid()', 'notificationId: z.string()'))).toBe(false);
});
it.each([
  ["lib/actions/branding.ts", "getBrandingAction", "return getBranding({ tenantId: ctx.tenantId });"],
  ["lib/actions/terminology.ts", "getTerminologyAction", "return getTerminology({ tenantId: ctx.tenantId });"],
  ["lib/actions/announcements.ts", "listMyNotificationsAction", "return listMyNotifications(ctx);"],
])("checks tenant or recipient authority for %s#%s", (path, action, boundary) => {
  const source = readFileSync(path, "utf8");
  expect(check(path, action, source)).toBe(true);
  expect(check(path, action, source.replace(boundary, "return [] as never;"))).toBe(false);
  expect(check(path, action, source.replace('"@/lib/auth/context"', '"@/lib/fake"'))).toBe(false);
});
