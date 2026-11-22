// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/components/tenant-sign-out", () => ({TenantSignOut:() => null}));
import { OwnerAccountControl } from "@/components/owner-home/owner-account-control";
afterEach(cleanup);
it("offers the authorized current club install in the mobile account menu", () => {
  render(<OwnerAccountControl tenantId="11111111-1111-4111-8111-111111111111" />);
  fireEvent.click(screen.getByText("Account"));
  expect(screen.getByRole("link",{name:/install this club/i}).getAttribute("href")).toBe("/clubs/11111111-1111-4111-8111-111111111111/install?source=staff");
});
