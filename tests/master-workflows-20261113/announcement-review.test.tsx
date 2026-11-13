// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const send = vi.fn();
const preview = vi.fn();
vi.mock("@/lib/actions/announcements", () => ({ sendAnnouncementAction: (...args: unknown[]) => send(...args), previewAnnouncementAudienceAction: (...args: unknown[]) => preview(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("requires explicit audience and a server preview before sending", async () => {
  preview.mockResolvedValue({ ok: true, asOf: "2026-11-13T00:00:00Z", inApp: {eligibleCount: 2}, whatsapp: {eligibleCount: 1} });
  render(<AnnouncementComposer batches={[{id:"b",name:"Batch A"}]} memberLabel="Members" batchLabel="Batch" guardianLabel="Guardians" />);
  fireEvent.change(screen.getByLabelText("Title"), {target:{value:"Notice"}});
  fireEvent.change(screen.getByLabelText("Message"), {target:{value:"Message"}});
  expect((screen.getByRole("button", {name:"Send announcement"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Audience"), {target:{value:"all"}});
  fireEvent.click(screen.getByRole("button", {name:/review audience/i}));
  await waitFor(() => expect(screen.getByText(/2 eligible in-app/i)).toBeTruthy());
  expect(screen.getByText(/1 eligible WhatsApp/i)).toBeTruthy();
  expect(screen.getByText(/estimate, not delivery confirmation/i)).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
});
it("disables sending when nobody is eligible and invalidates a previous review on scope change", async () => {
  preview.mockResolvedValue({ok:true,asOf:"2026-11-13T00:00:00Z",inApp:{eligibleCount:0},whatsapp:{eligibleCount:0}});
  render(<AnnouncementComposer batches={[{id:"b",name:"Batch A"}]} memberLabel="Members" batchLabel="Batch" guardianLabel="Guardians" />);
  fireEvent.change(screen.getByLabelText("Title"),{target:{value:"Notice"}});
  fireEvent.change(screen.getByLabelText("Message"),{target:{value:"Message"}});
  fireEvent.change(screen.getByLabelText("Audience"),{target:{value:"all"}});
  fireEvent.click(screen.getByRole("button",{name:/review audience/i}));
  await screen.findByText(/0 eligible in-app/i);
  expect((screen.getByRole("button",{name:"Send announcement"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Audience"),{target:{value:"batch"}});
  expect(screen.queryByText(/0 eligible in-app/i)).toBeNull();
  expect((screen.getByRole("button",{name:/review audience/i}) as HTMLButtonElement).disabled).toBe(true);
  expect(send).not.toHaveBeenCalled();
});
it("accepts the real preview contract when exclusion breakdowns are not supplied", async () => {
  preview.mockResolvedValue({ok:true,asOf:"2026-11-13T00:00:00Z",inApp:{eligibleCount:2},whatsapp:{eligibleCount:1}});
  render(<AnnouncementComposer batches={[]} memberLabel="Members" batchLabel="Batch" guardianLabel="Guardians" />);
  fireEvent.change(screen.getByLabelText("Audience"),{target:{value:"all"}});
  fireEvent.click(screen.getByRole("button",{name:/review audience/i}));
  expect(await screen.findByText(/2 eligible in-app/i)).toBeTruthy();
  expect(screen.queryByText(/in-app exclusions/i)).toBeNull();
});
it("shows exclusion counts only when the server actually provides them", async () => {
  preview.mockResolvedValue({ok:true,asOf:"2026-11-13T00:00:00Z",inApp:{eligibleCount:2,exclusions:{unlinked:3,revokedOrPending:4}},whatsapp:{eligibleCount:1,exclusions:{noDestination:5,noConsent:6,revokedOrOutOfScope:7}}});
  render(<AnnouncementComposer batches={[]} memberLabel="Members" batchLabel="Batch" guardianLabel="Guardians" />);
  fireEvent.change(screen.getByLabelText("Audience"),{target:{value:"all"}});
  fireEvent.click(screen.getByRole("button",{name:/review audience/i}));
  expect(await screen.findByText(/3 unlinked.*4 revoked or pending/i)).toBeTruthy();
  expect(screen.getByText(/5 without destination.*6 without consent.*7 revoked or out of scope/i)).toBeTruthy();
});
it("reports an unknown send outcome and does not automatically retry", async () => {
  preview.mockResolvedValue({ok:true,asOf:"2026-11-13T00:00:00Z",inApp:{eligibleCount:1},whatsapp:{eligibleCount:0}});
  send.mockRejectedValue(new Error("response lost"));
  render(<AnnouncementComposer batches={[]} memberLabel="Members" batchLabel="Batch" guardianLabel="Guardians" />);
  fireEvent.change(screen.getByLabelText("Title"),{target:{value:"Notice"}});
  fireEvent.change(screen.getByLabelText("Message"),{target:{value:"Message"}});
  fireEvent.change(screen.getByLabelText("Audience"),{target:{value:"parents"}});
  fireEvent.click(screen.getByRole("button",{name:/review audience/i}));
  await screen.findByText(/1 eligible in-app/i);
  fireEvent.click(screen.getByRole("button",{name:"Send announcement"}));
  expect(await screen.findByText(/may or may not have been sent/i)).toBeTruthy();
  expect(send).toHaveBeenCalledTimes(1);
});
