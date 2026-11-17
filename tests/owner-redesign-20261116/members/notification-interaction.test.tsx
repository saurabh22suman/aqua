// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/notification-destinations", () => ({ saveNotificationDestinationsAction: save }));
import { MemberNotificationDestinations } from "@/components/member-notification-destinations";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("cancels to the last saved selection, not the initial selection", async () => {
  save.mockResolvedValue({ ok: true });
  render(<MemberNotificationDestinations memberId="m" editHref="/owner/members/m/edit" communicationsAllowed minor={false} contacts={[
    { personId: "p", name: "Member", relationship: "self", phone: "123", selected: false },
  ]} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage destinations" }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Save destinations" }));
  await screen.findByText("Notification destinations saved.");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("1 selected contact")).toBeTruthy();
  expect(save).toHaveBeenCalledWith({ memberId: "m", personIds: ["p"] });
});
