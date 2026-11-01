// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const api = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/actions/announcements", () => ({ sendAnnouncementAction: api.send }));
import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
afterEach(() => { cleanup(); api.send.mockReset(); });
it("shows concise choices and the complete selected audience meaning", () => {
  render(<AnnouncementComposer batches={[{ id: "b", name: "Morning" }]} memberLabel="Swimmers" batchLabel="Group" guardianLabel="Guardians" />);
  const select = screen.getByLabelText("Audience") as HTMLSelectElement;
  expect(Array.from(select.options).map(o => [o.value, o.textContent])).toEqual([["all", "Everyone"], ["batch", "One group"], ["parents", "Parents and guardians"]]);
  expect(screen.getByText("Staff and linked accounts.")).toBeTruthy();
  fireEvent.change(select, { target: { value: "batch" } });
  expect(screen.getByText("One group's swimmers and guardians.")).toBeTruthy();
  fireEvent.change(select, { target: { value: "parents" } });
  expect(screen.getByText("Parents and guardians only.")).toBeTruthy();
});
it.each(["all", "batch", "parents"])("submits exactly the selected %s audience", async (audience) => {
  api.send.mockResolvedValue({ ok: true, recipientCount: 0 });
  render(<AnnouncementComposer batches={[{ id: "batch-id", name: "Morning" }]} memberLabel="Members" batchLabel="Batch" guardianLabel="Guardians" />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Update" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Message" } });
  fireEvent.change(screen.getByLabelText("Audience"), { target: { value: audience } });
  fireEvent.click(screen.getByRole("button", { name: "Send announcement" }));
  await waitFor(() => expect(api.send).toHaveBeenCalledWith({ title: "Update", body: "Message", audience, ...(audience === "batch" ? { batchId: "batch-id" } : {}) }));
});
