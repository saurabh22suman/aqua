// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { EnquiriesBoard } from "@/components/enquiries-board";
afterEach(cleanup);

it("offers a concise secondary Add enquiry action without losing the capture form", () => {
  render(<EnquiriesBoard initialEnquiries={[]} locations={[{ id: "loc-1", name: "Main" }]} canWrite variant="oversight" />);
  const add = screen.getByRole("button", { name: "Add enquiry" });
  expect(add.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(add);
  expect(screen.getByTestId("enquiry-capture-name")).toBeTruthy();
});

it("does not offer capture without permission", () => {
  render(<EnquiriesBoard initialEnquiries={[]} locations={[{ id: "loc-1", name: "Main" }]} canWrite={false} variant="oversight" />);
  expect(screen.queryByRole("button", { name: "Add enquiry" })).toBeNull();
});
