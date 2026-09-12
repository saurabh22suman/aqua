// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// P1-2 (mobile UX audit, 2026-09-12) — formatPhoneIN existed but only
// two surfaces used it. Settings, both "Me" pages, enquiries, staff
// invitations, guardian search results and the link-redeem screen all
// rendered the stored E.164 string raw. This sweep drives the real
// components/pages with a raw stored number and pins the formatted
// output; the source guard at the bottom covers the server pages whose
// fixtures are too heavy to drive.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("@/lib/actions/enquiries", () => ({
  createEnquiryAction: vi.fn(),
}));
vi.mock("@/lib/actions/staff-invitations", () => ({
  revokeInvitationAction: vi.fn(),
}));
vi.mock("@/lib/actions/invite-link", () => ({
  issueLoginLinkAction: vi.fn(),
}));
vi.mock("@/components/link-qr", () => ({ LinkQr: () => null }));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({}),
  requireReception: async () => ({}),
  requireCoach: async () => ({}),
}));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({}),
}));
vi.mock("@/lib/auth/permission", () => ({
  requirePermission: () => {},
}));
vi.mock("@/lib/services/staff", () => ({
  getCurrentStaffIdentity: async () => ({
    fullName: "Asha Owner",
    phone: "+919000000001",
  }),
}));
vi.mock("@/lib/actions/tenant-auth", () => ({
  logoutTenantAction: vi.fn(),
}));

import { EnquiriesBoard } from "@/components/enquiries-board";
import { InvitationsBoard } from "@/components/invitations-board";
import { LoginLinkRedeemForm } from "@/components/login-link-redeem-form";
import OwnerSettingsPage from "@/app/(owner)/owner/settings/page";
import CoachMePage from "@/app/(coach)/coach/me/page";
import ReceptionMePage from "@/app/(reception)/reception/me/page";
import type { EnquiryRow } from "@/lib/services/enquiries";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";

const RAW = "+919000000001";
const FORMATTED = "+91 90000 00001";

const renderedText = () => document.body.textContent ?? "";

afterEach(cleanup);

describe("phone display sweep (P1-2)", () => {
  it("formats the enquiry list phone", () => {
    const row = {
      id: "e1",
      fullName: "Walk-in Lead",
      phone: RAW,
      source: "walk-in",
      stage: "new",
    } as EnquiryRow;
    render(<EnquiriesBoard initialEnquiries={[row]} />);
    expect(renderedText()).toContain(FORMATTED);
  });

  it("formats the staff invitation phone", () => {
    const row = {
      membershipId: "m1",
      phone: RAW,
      status: "active",
      roleKey: "coach",
      locationNames: [],
    } as unknown as ListInvitationsRow;
    render(<InvitationsBoard rows={[row]} />);
    expect(renderedText()).toContain(FORMATTED);
  });

  it("formats the link-redeem screen phone", () => {
    render(
      <LoginLinkRedeemForm
        token="t"
        phone={RAW}
        roleKey="coach"
        tenantName="Aqua Worli"
        expiresAt="12 Sept 2026, 05:30 pm"
        credentialSet
        purpose="invite"
      />,
    );
    expect(renderedText()).toContain(FORMATTED);
  });

  it("formats the owner settings identity phone", async () => {
    render(await OwnerSettingsPage());
    expect(renderedText()).toContain(FORMATTED);
  });

  it("formats the coach Me phone", async () => {
    render(await CoachMePage());
    expect(renderedText()).toContain(FORMATTED);
  });

  it("formats the reception Me phone", async () => {
    render(await ReceptionMePage());
    expect(renderedText()).toContain(FORMATTED);
  });
});

describe("phone sweep source guard", () => {
  const MUST_FORMAT = [
    "app/(owner)/owner/enquiries/[enquiryId]/page.tsx",
    "app/(reception)/reception/enquiries/[enquiryId]/page.tsx",
    "app/(reception)/reception/members/[memberId]/page.tsx",
    "components/member-create-form.tsx",
    "components/enquiry-new-member-fields.tsx",
    "app/(owner)/owner/settings/page.tsx",
    "app/(coach)/coach/me/page.tsx",
    "app/(reception)/reception/me/page.tsx",
  ];
  const BANNED = [
    "· ${enquiry.phone}",
    "· {g.phone}",
    "· {r.phone}",
    "{identity?.phone ??",
  ];

  it("every remaining phone surface routes through formatPhoneIN", () => {
    const missing: string[] = [];
    for (const rel of MUST_FORMAT) {
      const source = readFileSync(rel, "utf8");
      if (!source.includes("formatPhoneIN")) missing.push(`${rel} (no formatPhoneIN)`);
      for (const snippet of BANNED) {
        if (source.includes(snippet)) missing.push(`${rel} still renders ${snippet}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
