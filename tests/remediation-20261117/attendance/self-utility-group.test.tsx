// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SelfHome } from "@/components/self-home";

const tenantId = "tenant-example";
const guideKey = "utility-test";
const entry = { memberId: "member-1", fullName: "Synthetic Member", memberCode: "S01", status: "active", facilityName: "Main" };
afterEach(() => { cleanup(); localStorage.clear(); });

describe.each([
  { audience: "member" as const, base: "/member", source: "member", guide: "Optional member guide" },
  { audience: "guardian" as const, base: "/family", source: "guardian", guide: "Optional family guide" },
])("$audience shortcuts", ({ audience, base, source, guide }) => {
  it.each([false, true])("groups correct links with guide retired=%s", (retired) => {
    if (retired) localStorage.setItem(`aqua:guide:${guideKey}`, "dismissed");
    render(<SelfHome view={{ clubName: "Synthetic Club", audience, entries: [entry] }} audience={audience} scopeKind="self_session" tenantId={tenantId} canViewOwnBilling guideKey={guideKey} />);
    const group = screen.getByRole("navigation", { name: "Club shortcuts" });
    const links = within(group).getAllByRole("link");
    expect(links.map(link => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Install this club", `/clubs/${tenantId}/install?source=${source}`],
      ["Announcements", `${base}/announcements`],
    ]);
    expect(screen.getByRole("button", { name: audience === "member" ? "Leave member view" : "Leave family view" })).toBeTruthy();
    expect(screen.getByRole("link", { name: audience === "member" ? "Fees and payments" : /Fees and payments for Synthetic Member/ }).getAttribute("href")).toBe(audience === "member" ? "/member/billing" : "/family/billing/member-1");
    if (retired) expect(screen.queryByRole("button", { name: "Show me around" })).toBeNull();
    else {
      fireEvent.click(screen.getByRole("button", { name: "Show me around" }));
      expect(screen.getByRole("region", { name: guide })).toBeTruthy();
      expect(screen.getByRole("navigation", { name: "Club shortcuts" })).toBe(group);
    }
  });
  it("keeps staff shortcuts separate from self-only announcements", () => {
    render(<SelfHome view={{ clubName: "Synthetic Club", audience, entries: [entry] }} audience={audience} scopeKind="staff_session" tenantId={tenantId} guideKey={guideKey} />);
    const group = screen.getByRole("navigation", { name: "Club shortcuts" });
    expect(within(group).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([`/clubs/${tenantId}/install?source=staff`]);
    expect(screen.queryByRole("link", { name: "Announcements" })).toBeNull();
    expect(screen.getByRole("link", { name: audience === "member" ? "Sign in to view fees" : /Sign in to view fees for Synthetic Member/ }).getAttribute("href")).toBe(`${base}/sign-in?clubId=${tenantId}`);
  });
});
