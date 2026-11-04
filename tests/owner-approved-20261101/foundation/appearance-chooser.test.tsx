// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OwnerArtwork } from "@/components/owner-artwork/owner-artwork";
const identity = { tenantId: "chooser-tenant", userId: "chooser-user" };
afterEach(() => { cleanup(); window.localStorage.removeItem("aqua:owner-art:chooser-tenant:chooser-user"); });
it("offers the personal sport choices and persists the selected choice on this device", () => {
  render(<OwnerArtwork identity={identity} {...{ mode: "chooser" }} />);
  expect(screen.getByText(/personal.*this device/i)).toBeTruthy();
  for (const label of ["Swimming", "Badminton", "Football", "Tennis", "Cricket", "Yoga/Fitness", "Multi-sport", "None"]) expect(screen.getByRole("radio", { name: label })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));
  expect((screen.getByRole("radio", { name: "Tennis" }) as HTMLInputElement).checked).toBe(true);
  expect(window.localStorage.getItem("aqua:owner-art:chooser-tenant:chooser-user")).toBe("tennis");
});
it("updates the artwork preview immediately, including None", () => {
  render(<OwnerArtwork identity={identity} mode="chooser" />);
  const preview = screen.getByTestId("artwork-preview");
  fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));
  expect(preview.querySelector("[data-owner-artwork]")?.getAttribute("style")).toContain("tennis");
  fireEvent.click(screen.getByRole("radio", { name: "None" }));
  expect(preview.querySelector("[data-owner-artwork]")).toBeNull();
});
it("selects preview artwork geometry from the preview width, matching Home", () => {
  let update: ((width: number) => void) | undefined;
  class Observer {
    constructor(callback: ResizeObserverCallback) { update = width => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    observe() {} disconnect() {} unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", Observer);
  render(<OwnerArtwork identity={identity} mode="chooser" />);
  const mask = () => screen.getByTestId("artwork-preview").querySelector<HTMLElement>("[data-owner-artwork]")?.style.maskImage;
  act(() => update?.(319)); expect(mask()).toContain("-tall-");
  act(() => update?.(320)); expect(mask()).toContain("-phone-");
  act(() => update?.(1000)); expect(mask()).toContain("-wide-");
  fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));
  expect(mask()).toContain("tennis-wide");
  vi.unstubAllGlobals();
});
it("recovers from malformed saved values and reports denied writes", () => {
  window.localStorage.setItem("aqua:owner-art:chooser-tenant:chooser-user", "<invalid>");
  render(<OwnerArtwork identity={identity} {...{ mode: "chooser" }} />);
  expect((screen.getByRole("radio", { name: "Multi-sport" }) as HTMLInputElement).checked).toBe(true);
  const denied = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  fireEvent.click(screen.getByRole("radio", { name: "None" }));
  expect(screen.getByRole("status").textContent).toMatch(/could not save/i);
  denied.mockRestore();
});
