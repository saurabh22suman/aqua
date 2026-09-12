// @vitest-environment jsdom
//
// Slice 10 — QR component for minted login links.
//
// The QR encodes the same absolute URL the copy button shows. The
// qrcode package is imported lazily so it only loads when a link is
// actually displayed (the panels render this component after
// minting); the token stays in the browser.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toStringMock = vi.fn();
vi.mock("qrcode", () => ({
  toString: (...args: unknown[]) => toStringMock(...args),
}));

import { LinkQr } from "@/components/link-qr";

function expectInDocument(el: HTMLElement | null): void {
  expect(el).not.toBeNull();
  expect(document.body.contains(el)).toBe(true);
}

describe("LinkQr", () => {
  afterEach(() => {
    cleanup();
    toStringMock.mockReset();
  });

  it("generates an SVG QR for the given URL", async () => {
    toStringMock.mockResolvedValue('<svg data-testid="fake-qr"></svg>');
    render(<LinkQr url="https://example.com/login/link/tok-123" />);

    await waitFor(() => expect(toStringMock).toHaveBeenCalledTimes(1));
    expect(toStringMock.mock.calls[0]![0]).toBe(
      "https://example.com/login/link/tok-123",
    );
    await waitFor(() => expectInDocument(screen.getByTestId("fake-qr")));
  });

  it("regenerates when the URL changes", async () => {
    toStringMock.mockResolvedValue('<svg data-testid="fake-qr"></svg>');
    const { rerender } = render(<LinkQr url="https://example.com/a" />);
    await waitFor(() => expect(toStringMock).toHaveBeenCalledWith("https://example.com/a", expect.anything()));

    rerender(<LinkQr url="https://example.com/b" />);
    await waitFor(() =>
      expect(toStringMock).toHaveBeenCalledWith("https://example.com/b", expect.anything()),
    );
  });

  it("shows a placeholder until the SVG is ready", () => {
    // Never resolves during this test — the placeholder must be the
    // visible state.
    toStringMock.mockReturnValue(new Promise(() => {}));
    render(<LinkQr url="https://example.com/login/link/tok-123" />);
    expectInDocument(screen.getByTestId("link-qr-loading"));
  });
});
