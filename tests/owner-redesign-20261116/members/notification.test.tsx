import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberNotificationDestinations } from "@/components/member-notification-destinations";

vi.mock("@/lib/actions/notification-destinations", () => ({ saveNotificationDestinationsAction: vi.fn() }));

it("offers a real edit destination instead of a disabled save when there are no contacts", () => {
  const html = renderToStaticMarkup(<MemberNotificationDestinations memberId="abc" contacts={[]} communicationsAllowed={false} minor editHref="/owner/members/abc/edit" />);
  expect(html).toContain('href="/owner/members/abc/edit');
  expect(html).toContain("Add contact details");
  expect(html).not.toContain("Save destinations");
  expect(html).toContain("consent is not active");
});
