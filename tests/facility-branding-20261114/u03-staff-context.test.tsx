import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/worker" }));
import { StaffClubContext } from "@/components/staff-ui/staff-club-context";

it("shows the current role and assigned site within the existing club context", () => {
  const props = { clubName: "Synthetic Club", roleLabel: "Worker", siteLabel: "North Site" };
  const html = renderToStaticMarkup(<StaffClubContext {...props} />);
  expect(html).toContain("Synthetic Club");
  expect(html).toContain("Worker");
  expect(html).toContain("North Site");
});
