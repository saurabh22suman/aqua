// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { guidePreferenceKey } from "@/components/onboarding/guide-preference-key";
import { GuideHelpButton } from "@/components/onboarding/guide-help-button";
import { renderToStaticMarkup } from "react-dom/server";

const items = [{ key: "one", title: "First check", detail: "Visible guidance" }];
afterEach(() => { cleanup(); localStorage.clear(); history.replaceState(null, "", "/"); });
it("retires only this identity and role, survives remount, and can be reopened from Help", async () => {
  const a = render(<OptionalWorkspaceGuide items={items} preferenceKey="opaque-person-a-owner" />);
  fireEvent.click(screen.getByRole("button", { name: /don.t show again/i }));
  expect(screen.queryByRole("button", { name: /show me around/i })).toBeNull();
  a.unmount();
  const b = render(<OptionalWorkspaceGuide items={items} preferenceKey="opaque-person-b-owner" />);
  expect(screen.getByRole("button", { name: /show me around/i })).toBeTruthy();
  b.unmount();
  history.replaceState(null, "", "/family");
  render(<><GuideHelpButton homeHref="/family" /><OptionalWorkspaceGuide items={items} preferenceKey="opaque-person-a-owner" /></>);
  await waitFor(() => expect(screen.queryByRole("button", { name: /show me around/i })).toBeNull());
  fireEvent.click(screen.getByRole("link", { name: /help: open guide/i }));
  expect(screen.getByRole("heading", { name: "First check" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /finish guide/i }));
  expect(screen.queryByRole("button", { name: /show me around/i })).toBeNull();
});
it("does not offer permanent device dismissal to an anonymous context", () => {
  render(<OptionalWorkspaceGuide items={items} />);
  expect(screen.getByRole("button", { name: /skip for now/i })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /don.t show again/i })).toBeNull();
});
it("uses opaque independent keys for each user, role and club", () => {
  const key = guidePreferenceKey("club-a", "user-a", "member");
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  expect(key).not.toContain("user-a");
  expect(key).not.toBe(guidePreferenceKey("club-a", "user-b", "member"));
  expect(key).not.toBe(guidePreferenceKey("club-a", "user-a", "guardian"));
  expect(key).not.toBe(guidePreferenceKey("club-b", "user-a", "member"));
  expect(guidePreferenceKey("club-a", null, "member")).toBeUndefined();
});
it("does not claim permanent dismissal when device storage fails", () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage denied"); });
  try {
    render(<OptionalWorkspaceGuide items={items} preferenceKey="opaque-user" />);
    fireEvent.click(screen.getByRole("button", { name: /don.t show again/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/could not save/i);
    expect(screen.getByRole("button", { name: /show me around/i })).toBeTruthy();
  } finally { setItem.mockRestore(); }
});
it("provides a normal role-home fragment link for Help from another page", () => {
  render(<GuideHelpButton homeHref="/family" />);
  expect(screen.getByRole("link", { name: /help: open guide/i }).getAttribute("href")).toBe("/family#workspace-guide");
});
it("opens from a direct role-home fragment even after retirement", () => {
  localStorage.setItem("aqua:guide:opaque-user", "dismissed");
  history.replaceState(null, "", "/family#workspace-guide");
  render(<OptionalWorkspaceGuide items={items} preferenceKey="opaque-user" />);
  expect(screen.getByRole("heading", { name: "First check" })).toBeTruthy();
});
it("does not intercept modified clicks on the Help link", () => {
  history.replaceState(null, "", "/family");
  const listener = vi.fn(); window.addEventListener("aqua:open-workspace-guide", listener);
  try {
    render(<GuideHelpButton homeHref="/family" />);
    const link = screen.getByRole("link", { name: /help: open guide/i });
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(link, { ctrlKey: true });
    expect(listener).not.toHaveBeenCalled();
  } finally { window.removeEventListener("aqua:open-workspace-guide", listener); }
});
it("returns focus to a visible page heading after permanent retirement", () => {
  render(<main><h1>Family home</h1><details><summary>Account</summary><GuideHelpButton homeHref="/family" /></details><OptionalWorkspaceGuide items={items} preferenceKey="opaque-user" /></main>);
  fireEvent.click(screen.getByRole("button", { name: /don.t show again/i }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Family home" }));
});
it("consumes a direct Help fragment without reopening after retirement and reload", () => {
  localStorage.setItem("aqua:guide:opaque-user", "dismissed");
  history.replaceState(null, "", "/family?tab=one#workspace-guide");
  const view = render(<OptionalWorkspaceGuide items={items} preferenceKey="opaque-user" />);
  expect(screen.getByRole("heading", { name: "First check" })).toBeTruthy();
  expect(window.location.pathname + window.location.search + window.location.hash).toBe("/family?tab=one");
  fireEvent.click(screen.getByRole("button", { name: /finish guide/i }));
  view.unmount();
  render(<OptionalWorkspaceGuide items={items} preferenceKey="opaque-user" />);
  expect(screen.queryByRole("heading", { name: "First check" })).toBeNull();
});
it("does not flash a recurring guide control before the device preference is read", () => {
  const html = renderToStaticMarkup(<OptionalWorkspaceGuide items={items} preferenceKey="opaque-user" startCollapsed />);
  expect(html).not.toContain("Show me around");
});
