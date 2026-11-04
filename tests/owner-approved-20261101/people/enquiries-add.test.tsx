// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { EnquiriesBoard } from "@/components/enquiries-board";

beforeAll(() => {
  // jsdom has no layout engine, so scrollIntoView is not implemented.
  // The owner's capture brings its name field into view when it opens.
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});

afterEach(cleanup);

it("offers a concise secondary Add enquiry action without losing the capture form", () => {
  render(<EnquiriesBoard initialEnquiries={[]} locations={[{ id: "loc-1", name: "Main" }]} canWrite variant="oversight" />);
  const add = screen.getByRole("button", { name: "Add enquiry" });
  // The enquiries create action is now the SHARED create action: it
  // OPENS the capture panel, so the panel is simply absent until it is
  // pressed. It is no longer a disclosure toggle that stays on screen
  // with aria-expanded.
  expect(screen.queryByTestId("enquiry-capture-name")).toBeNull();
  fireEvent.click(add);
  expect(screen.getByTestId("enquiry-capture-name")).toBeTruthy();
});

it("does not offer capture without permission", () => {
  render(<EnquiriesBoard initialEnquiries={[]} locations={[{ id: "loc-1", name: "Main" }]} canWrite={false} variant="oversight" />);
  expect(screen.queryByRole("button", { name: "Add enquiry" })).toBeNull();
});
