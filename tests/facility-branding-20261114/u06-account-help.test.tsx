import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
vi.mock("@/components/staff-club-install-link", () => ({ StaffClubInstallLink: () => null }));
vi.mock("@/components/owner-ui/owner-link", () => ({ OwnerLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/components/ui/TransientDisclosure", () => ({ TransientDisclosure: ({ trigger, children }: { trigger: React.ReactNode; children: React.ReactNode }) => <div><button>{trigger}</button>{children}</div> }));
import { OwnerAccountControl } from "@/components/owner-home/owner-account-control";

it("offers the existing owner home guide only when the authorised home has one", () => {
  const enabled = renderToStaticMarkup(<OwnerAccountControl {...{ accountName: null, guideHomeHref: "/owner" }} />);
  expect(enabled).toContain('href="/owner#workspace-guide"');
  expect(enabled).toContain("Help: open guide");
  const accountant = renderToStaticMarkup(<OwnerAccountControl />);
  expect(accountant).not.toContain("Help: open guide");
  expect(accountant).not.toContain("#workspace-guide");
});
