import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/reception" }));
import { StaffClubContext } from "@/components/staff-ui/staff-club-context";

it("keeps role and site orientation without repeating a guide link in the header", () => {
  const props = { clubName: "Synthetic Club", roleLabel: "receptionist", siteLabel: "Kharghar", guideHomeHref: "/reception" };
  const html = renderToStaticMarkup(<StaffClubContext {...props} />);
  expect(html).toContain("Kharghar");
  expect(html).toContain("Receptionist");
  expect(html).not.toContain("#workspace-guide");
});
