import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RegisterBoard } from "@/components/register-board";

vi.mock("@/lib/hooks/use-offline-register", () => ({
  useOfflineRegister: () => ({ marks: {}, mark: vi.fn(), markedCount: 0, pending: 2, online: false,
    savedAtLabel: null, hasActiveFailure: false, saving: 0, retrySync: vi.fn(), offlineAvailable: true, sessionEnded: false }),
}));
it("warns pending marks can be removed on expiry or sign-out", () => {
  const html = renderToStaticMarkup(<RegisterBoard sessionId="session" rows={[]} offlineSyncEnabled offlineIdentity={{ scope: "a".repeat(64), expiresAt: 2000000000000 }} />);
  expect(html).toMatch(/expir/i);
  expect(html).toMatch(/sign.out/i);
  expect(html).toMatch(/remov|delet|lost/i);
});
