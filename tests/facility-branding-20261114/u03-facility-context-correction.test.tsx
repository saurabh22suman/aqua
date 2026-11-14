import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/owner/fees", useSearchParams: () => new URLSearchParams() }));
import { FacilitySwitcher } from "@/components/facility-switcher";

it("shows the single authorised facility without claiming all facilities", () => {
  const html = renderToStaticMarkup(<FacilitySwitcher locations={[{ id: "site-a", name: "Kharghar" }]} />);
  expect(html).toContain("Kharghar");
  expect(html).not.toContain("All facilities");
});
