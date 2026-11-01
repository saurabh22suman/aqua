// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner mobile import/consent controls — intended RED.
// The file picker must use the shared 48px control geometry and file-button
// tint; each consent row must be one real label target with at least a 44px
// clickable height while the visual checkbox stays 20px.

vi.mock("@/lib/actions/member-import", () => ({
  previewMemberImportAction: vi.fn(),
  commitMemberImportAction: vi.fn(),
}));

import { MemberImportForm } from "@/components/member-import-form";
import { MemberConsentChoices } from "@/components/member-consent-choices";

afterEach(cleanup);

describe("member import file control", () => {
  it("uses the 48px shared token geometry and a tinted file button", () => {
    render(<MemberImportForm />);

    const input = screen.getByLabelText("CSV file") as HTMLInputElement;
    expect(input.className).toContain("min-h-12");
    expect(input.className).toContain("rounded-ctl");
    expect(input.className).toContain("border-[var(--control-border)]");
    expect(input.className).toContain("file:bg-[var(--control-surface-action)]");
    expect(input.className).toContain("focus:border-[var(--accent-strong)]");
    expect(input.className).toContain("disabled:opacity-60");
  });
});

describe("consent rows", () => {
  it("makes each associated label the full 44px clickable row without resizing the checkbox", () => {
    const onProcessing = vi.fn();
    const onCommunications = vi.fn();
    render(
      <MemberConsentChoices
        minor={false}
        memberLabel="member"
        processing={false}
        communications={false}
        onProcessing={onProcessing}
        onCommunications={onCommunications}
      />,
    );

    const processing = screen.getByTestId("consent-checkbox") as HTMLInputElement;
    const communications = screen.getByTestId(
      "communications-consent-checkbox",
    ) as HTMLInputElement;
    const processingLabel = processing.closest("label");
    const communicationsLabel = communications.closest("label");

    expect(processingLabel).toBeTruthy();
    expect(communicationsLabel).toBeTruthy();
    expect(processingLabel!.className).toContain("min-h-11");
    expect(communicationsLabel!.className).toContain("min-h-11");
    expect(processingLabel!.contains(processing)).toBe(true);
    expect(communicationsLabel!.contains(communications)).toBe(true);
    expect(processing.className).toContain("h-5");
    expect(processing.className).toContain("w-5");
    expect(communications.className).toContain("h-5");
    expect(communications.className).toContain("w-5");

    fireEvent.click(processingLabel!);
    expect(onProcessing).toHaveBeenCalledWith(true);
    fireEvent.click(communicationsLabel!);
    expect(onCommunications).toHaveBeenCalledWith(true);
  });
});
