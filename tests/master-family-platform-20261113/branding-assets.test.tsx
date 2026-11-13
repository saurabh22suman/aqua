// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const upload = vi.hoisted(() => vi.fn<() => Promise<{ ok: boolean }>>(async () => ({ ok: true })));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/branding", () => ({ updateBrandingAction: vi.fn(), uploadBrandingAssetAction: upload }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { BrandingForm } from "@/components/branding/branding-form";

afterEach(() => { cleanup(); upload.mockReset(); upload.mockResolvedValue({ ok: true }); refresh.mockClear(); });
it("offers separate logo and install icon upload controls", () => {
  render(<BrandingForm initial={{ displayName: "Example Club", shortName: "EC", accent: "mango" }} />);
  expect((screen.getByLabelText(/club logo/i) as HTMLInputElement).type).toBe("file");
  expect((screen.getByLabelText(/install icon/i) as HTMLInputElement).type).toBe("file");
  expect(screen.getByText(/install.*(may|might|can).*(update|change)/i)).toBeTruthy();
});
it("submits the selected club logo and reports the server result", async () => {
  render(<BrandingForm initial={{ displayName: "Example Club", shortName: "EC", accent: "mango" }} />);
  const file = new File(["synthetic"], "logo.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText(/club logo/i), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: /upload logo/i }));
  await waitFor(() => expect(upload).toHaveBeenCalledOnce());
  expect(screen.getByRole("status").textContent).toMatch(/saved/i);
});
it("previews an existing authenticated club logo", () => {
  const initial = { displayName: "Example Club", shortName: "EC", accent: "mango" as const, logoUrl: "/api/branding/logo?v=abc" };
  render(<BrandingForm initial={initial} />);
  expect(screen.getByRole("img", { name: /club logo/i }).getAttribute("src")).toContain("/api/branding/logo");
});
it("prevents changing the selected logo during an unresolved upload", async () => {
  let finish!: (value: { ok: boolean }) => void;
  upload.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<BrandingForm initial={{ displayName: "Example Club", shortName: "EC", accent: "mango" }} />);
  const input = screen.getByLabelText(/club logo/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["a"], "first.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: /upload logo/i }));
  expect(input.disabled).toBe(true);
  await act(async () => finish({ ok: true }));
  expect(screen.getByRole("status").textContent).toMatch(/saved/i);
});
it("refreshes and reports an unconfirmed result when the response is lost", async () => {
  upload.mockRejectedValueOnce(new Error("connection lost"));
  render(<BrandingForm initial={{ displayName: "Example Club", shortName: "EC", accent: "mango" }} />);
  fireEvent.change(screen.getByLabelText(/club logo/i), { target: { files: [new File(["a"], "first.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: /upload logo/i }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not confirm/i));
  expect(refresh).toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/check.*before.*retry/i);
});
it("reports a definite refusal without claiming the image caused it", async () => {
  upload.mockResolvedValueOnce({ ok: false });
  render(<BrandingForm initial={{ displayName: "Example Club", shortName: "EC", accent: "mango" }} />);
  fireEvent.change(screen.getByLabelText(/club logo/i), { target: { files: [new File(["a"], "first.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: /upload logo/i }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not saved/i));
  expect(screen.getByRole("alert").textContent).toMatch(/try again later/i);
});
it("shows the fixed-size initials fallback if the settings logo fails to load", () => {
  render(<BrandingForm initial={{ displayName: "Example Club", shortName: "EC", accent: "mango", logoUrl: "/api/branding/logo?v=abc" }} />);
  fireEvent.error(screen.getByRole("img", { name: /club logo/i }));
  expect(screen.queryByRole("img", { name: /club logo/i })).toBeNull();
  expect(screen.getByRole("img", { name: "E mark" })).toBeTruthy();
});
