import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
vi.mock("@/components/staff-club-install-link", () => ({ StaffClubInstallLink: () => null }));
vi.mock("@/components/owner-ui/owner-link", () => ({ OwnerLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/components/ui/TransientDisclosure", () => ({ TransientDisclosure: ({ trigger }: { trigger: React.ReactNode }) => <button>{trigger}</button> }));
import { OwnerAccountControl } from "@/components/owner-home/owner-account-control";

it("uses a recognisable account icon instead of a question mark when the person's name is missing", () => {
  const html = renderToStaticMarkup(<OwnerAccountControl accountName={null} />);
  expect(html).toContain("Account");
  expect(html).toContain("<svg");
  expect(html).not.toContain(">?</span>");
});

it("keeps the person's own initials when a name exists", () => {
  const html = renderToStaticMarkup(<OwnerAccountControl accountName="Synthetic Owner" />);
  expect(html).toContain(">SO</span>");
  expect(html).toContain("Account");
});
