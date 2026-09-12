// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Phase 5 (mobile UX plan v2) — F23. The identity QR card sat above
// the h1 and always rendered its 160×160 code, pushing name, status
// and attendance below the fold on a 360px phone. It collapses behind
// a native <details> (no client JS, zero bundle) titled "Show identity
// card"; the operational fields lead.

vi.mock("@/lib/members/id-card", () => ({
  buildMemberIdPayload: (slug: string, uuid: string) => `aqua://m/${slug}/${uuid}`,
  renderMemberIdQrSvg: async () => "<svg></svg>",
}));

import { MemberIdCard } from "@/components/member-id-card";
import type { TerminologyState } from "@/lib/terminology/keys";

const TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

afterEach(cleanup);

describe("MemberIdCard QR collapse (F23)", () => {
  it("renders a collapsed details element with a verb summary", async () => {
    const ui = await MemberIdCard({
      tenantSlug: "demo-academy",
      tenantDisplayName: "Aqua Worli",
      tenantAccent: "mango",
      initials: "AW",
      memberFullName: "Arjun Mehta",
      memberCode: "AQUA-001",
      memberUuid: "11111111-1111-1111-1111-111111111111",
      terminology: TERMINOLOGY,
    });
    const { container } = render(ui);

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Show identity card")).toBeTruthy();
  });

  it("keeps the identity fields above the QR block", async () => {
    const ui = await MemberIdCard({
      tenantSlug: "demo-academy",
      tenantDisplayName: "Aqua Worli",
      tenantAccent: "mango",
      initials: "AW",
      memberFullName: "Arjun Mehta",
      memberCode: "AQUA-001",
      memberUuid: "11111111-1111-1111-1111-111111111111",
      terminology: TERMINOLOGY,
    });
    const { container } = render(ui);

    const name = container.querySelector('[data-testid="id-card-name"]');
    const details = container.querySelector("details");
    expect(name).not.toBeNull();
    expect(details).not.toBeNull();
    // DOM order: name/code before the collapsed QR.
    expect(
      name!.compareDocumentPosition(details!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
