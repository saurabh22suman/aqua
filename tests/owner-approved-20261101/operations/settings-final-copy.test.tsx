// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/actions/skill-ladder", () => ({ updateSkillLevelAction: vi.fn(), updateSkillNodeAction: vi.fn() }));
vi.mock("@/lib/actions/menu", () => ({ listMenuAction: async () => ({categories: [], items: []}), createMenuCategoryAction: vi.fn(), updateMenuCategoryAction: vi.fn(), createMenuItemAction: vi.fn(), updateMenuItemAction: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ listLocationsAction: async () => [] }));
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner: async () => ({}), requirePagePermission: vi.fn()}));
vi.mock("next/navigation", () => ({useRouter: () => ({refresh: vi.fn()})}));
import { SkillLadderManager } from "@/components/skill-ladder-manager";
import OwnerMenuPage from "@/app/(owner)/owner/settings/menu/page";

it.each([true, false])("describes an unconfigured ladder without promising unavailable setup (canEdit=%s)", canEdit => {
  const html = renderToStaticMarkup(<SkillLadderManager ladders={[]} canEdit={canEdit} />);
  expect(html).toContain("No skill ladder yet");
  expect(html).not.toMatch(/apply the swimming preset|add levels/i);
});
it("states menu tax details once while retaining reception read-only context", async () => {
  const html = renderToStaticMarkup(await OwnerMenuPage());
  expect(html.match(/GST/g)).toHaveLength(1);
  expect(html.match(/SAC/g)).toHaveLength(1);
  expect(html).toMatch(/Reception sees this menu/);
  expect(html).toMatch(/cannot change it/);
  expect(html).toContain("Menu catalogue");
});
