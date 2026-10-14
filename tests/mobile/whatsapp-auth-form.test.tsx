// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppAuthForm } from "@/components/whatsapp-auth-form";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function reply(body: object) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

async function requestCode(purpose: "ops_login" | "pin_reset" = "ops_login") {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValueOnce(reply({ step: "code", notice: "Check WhatsApp for your code." }));
  const view = render(<WhatsAppAuthForm purpose={purpose} />);
  fireEvent.change(view.getByRole("textbox", { name: "Registered mobile number" }), { target: { value: "9000000099" } });
  fireEvent.click(view.getByRole("button", { name: "Send WhatsApp code" }));
  await waitFor(() => expect(view.getByRole("textbox", { name: "6-digit WhatsApp code" })).toBe(document.activeElement));
  return view;
}

describe("WhatsApp browser authentication", () => {
  it("disables the server-rendered form until its JSON submit handler is ready", () => {
    const markup = renderToStaticMarkup(<WhatsAppAuthForm purpose="ops_login" />);
    expect(markup).toMatch(/<fieldset disabled=""/);
    expect(markup).toContain("Enable JavaScript and reload this page");
  });

  it("requests and verifies an ops code without navigating to the JSON endpoint", async () => {
    const view = await requestCode();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/ops/api/whatsapp-auth");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ intent: "request", phone: "9000000099" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeDefined();
    fetchMock.mockResolvedValueOnce(reply({ step: "done", redirectPath: "/ops" }));
    fireEvent.change(view.getByRole("textbox", { name: "6-digit WhatsApp code" }), { target: { value: "123456" } });
    fireEvent.click(view.getByRole("button", { name: "Verify code" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/ops"));
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ intent: "verify", code: "123456" });
  });

  it("keeps invalid codes retryable and preserves the phone when requesting a replacement", async () => {
    const view = await requestCode();
    fetchMock.mockResolvedValueOnce(reply({ step: "code", error: "Invalid or expired code. Request a new code if needed." }));
    const code = view.getByRole("textbox", { name: "6-digit WhatsApp code" });
    fireEvent.change(code, { target: { value: "000000" } });
    fireEvent.click(view.getByRole("button", { name: "Verify code" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Invalid or expired"));
    expect(code.getAttribute("aria-invalid")).toBe("true");
    expect(code.getAttribute("aria-describedby")).toContain(view.getByRole("alert").id);
    fireEvent.click(view.getByRole("button", { name: "Request a new code or change number" }));
    const phone = view.getByRole("textbox", { name: "Registered mobile number" }) as HTMLInputElement;
    expect(phone.value).toBe("9000000099");
    expect(document.activeElement).toBe(phone);
    expect(view.queryByRole("alert")).toBeNull();
  });

  it("locks edits and duplicate submissions during a request, then allows retry after a transport failure", async () => {
    vi.stubGlobal("fetch", fetchMock);
    let rejectRequest: (reason: Error) => void = () => { throw new Error("Request was not started"); };
    fetchMock.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectRequest = reject; }));
    const view = render(<WhatsAppAuthForm purpose="pin_reset" />);
    const phone = view.getByRole("textbox", { name: "Registered mobile number" });
    fireEvent.change(phone, { target: { value: "9000000002" } });
    const form = phone.closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(phone.closest("fieldset")?.disabled).toBe(true);
    expect(view.getByRole("status").textContent).toContain("Requesting your code");
    rejectRequest(new Error("Network unavailable"));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Please try again"));
    expect(phone.closest("fieldset")?.disabled).toBe(false);
    expect(form.getAttribute("aria-busy")).toBe("false");
  });

  it("shows a failed replacement-code request instead of hiding its retry message", async () => {
    const view = await requestCode();
    fireEvent.click(view.getByRole("button", { name: "Request a new code or change number" }));
    fetchMock.mockRejectedValueOnce(new Error("Capture service unavailable"));
    fireEvent.click(view.getByRole("button", { name: "Send WhatsApp code" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Please try again"));
    expect(view.getByRole("button", { name: "Send WhatsApp code" }).hasAttribute("disabled")).toBe(false);
  });

  it("verifies recovery before showing new PIN fields and saves the matching PIN", async () => {
    const view = await requestCode("pin_reset");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/login/pin-recovery");
    fetchMock.mockResolvedValueOnce(reply({ step: "pin" }));
    fireEvent.change(view.getByRole("textbox", { name: "6-digit WhatsApp code" }), { target: { value: "123456" } });
    fireEvent.click(view.getByRole("button", { name: "Verify code" }));
    await waitFor(() => expect(view.getByLabelText("New PIN")).toBe(document.activeElement));
    fireEvent.change(view.getByLabelText("New PIN"), { target: { value: "654321" } });
    fireEvent.change(view.getByLabelText("Re-enter new PIN"), { target: { value: "654321" } });
    fetchMock.mockResolvedValueOnce(reply({ step: "done", notice: "Your PIN has been saved. Sign in with your new PIN." }));
    fireEvent.click(view.getByRole("button", { name: "Save PIN" }));
    await waitFor(() => expect(view.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe("/login"));
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ intent: "save", pin: "654321", confirmPin: "654321" });
    expect(router.push).not.toHaveBeenCalled();
  });
});
