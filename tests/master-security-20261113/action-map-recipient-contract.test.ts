import { expect, it } from "vitest";
import { ACTION_PERMISSION_MAP } from "@/lib/auth/action-permissions";

it("records the preview and closure permissions without inventing a directory grant for personal inboxes", () => {
  expect(ACTION_PERMISSION_MAP.previewAnnouncementAudienceAction).toBe("messaging.send");
  expect(ACTION_PERMISSION_MAP.reviewClosureAction).toBe("settings.manage");
  expect(ACTION_PERMISSION_MAP.uploadBrandingAssetAction).toBe("settings.manage");
  expect(ACTION_PERMISSION_MAP.listMyNotificationsAction).toBeUndefined();
  expect(ACTION_PERMISSION_MAP.markNotificationReadAction).toBeUndefined();
});
