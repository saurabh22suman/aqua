// @vitest-environment jsdom
//
// D-lane acceptance for the consent helper copy (task D, PHASE1).
//
// The registration form's helper sentence claimed that "notifications ... stop
// when communications consent is withdrawn". That is broader than the product
// rule it describes:
//
//   * withdrawing COMMUNICATIONS consent stops the optional updates that exist
//     only because we hold that consent — announcements, attendance alerts and
//     progress notes (docs/project-scope.md §7.1, "Withdrawal is per-purpose");
//   * essential fee/receipt notices are addressed to the guardian's own
//     contractual obligation and follow separate rules
//     (lib/messaging/notification-enqueue.ts keeps them when
//     `essential` is set, and only suppresses non-essential events).
//
// The copy must therefore state the optional/essential split without promising
// delivery, without claiming that every message keeps flowing, and without
// touching consent routing, the processing/communications separation, guardian
// attribution, the selected-linked-contact scope, the control ids, the
// callbacks or the default values.
//
// These cases are written against the component's rendered output only.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberConsentChoices } from "@/components/member-consent-choices";

function renderChoices(overrides: Partial<{
  minor: boolean | null;
  memberLabel: string;
  processing: boolean;
  communications: boolean;
}> = {}) {
  const onProcessing = vi.fn();
  const onCommunications = vi.fn();
  const props = {
    minor: false,
    memberLabel: "member",
    processing: true,
    communications: false,
    onProcessing,
    onCommunications,
    ...overrides,
  };
  render(<MemberConsentChoices {...props} />);
  return { onProcessing, onCommunications, text: document.body.textContent ?? "" };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("consent helper copy states the optional/essential split", () => {
  it("says withdrawing the choice stops optional updates, and that essential fee/receipt notices follow separate rules", () => {
    const { text } = renderChoices();

    expect(text).toContain(
      "stops optional updates such as announcements, attendance alerts and progress notes",
    );
    expect(text).toContain("Essential fee and receipt notices follow separate rules");
  });

  it("no longer claims that notifications as a whole stop on withdrawal", () => {
    const { text } = renderChoices();

    expect(text).not.toContain("stop when communications consent is withdrawn");
    expect(text).not.toMatch(/all (notifications|messages) stop/i);
  });

  it("does not promise delivery or verification of any message", () => {
    const { text } = renderChoices();

    expect(text).not.toMatch(/guarantee[sd]?\b/i);
    expect(text).not.toMatch(/will be delivered|delivery confirmed|delivered to/i);
  });

  it("keeps the selected-linked-contact scope in the same helper sentence", () => {
    const { text } = renderChoices();

    expect(text).toContain("selected linked numbers");
  });
});

describe("consent choices keep their structure and behaviour", () => {
  it("keeps the processing and communications choices separate and labelled", () => {
    renderChoices();

    const processing = screen.getByLabelText(/agreed to data processing/i);
    const communications = screen.getByLabelText(
      /agrees to optional academy communications/i,
    );
    expect(processing).toHaveProperty("id", "member-consent-processing");
    expect(communications).toHaveProperty("id", "member-consent-communications");
    expect(processing).not.toBe(communications);
  });

  it("attributes a minor's choices to the guardian", () => {
    const { text } = renderChoices({ minor: true });

    expect(text).toContain("The guardian above has agreed to data processing");
    expect(text).toContain(
      "The guardian above agrees to optional academy communications",
    );
  });

  it("uses the tenant's own word for a member", () => {
    const { text } = renderChoices({ memberLabel: "swimmer" });

    expect(text).toContain("This swimmer has agreed to data processing");
    expect(text).toContain("This swimmer agrees to optional academy communications");
  });

  it("reflects the default values and reports the change without touching the other choice", () => {
    const { onProcessing, onCommunications } = renderChoices({
      processing: true,
      communications: false,
    });

    const processing = screen.getByLabelText(/agreed to data processing/i) as HTMLInputElement;
    const communications = screen.getByLabelText(
      /agrees to optional academy communications/i,
    ) as HTMLInputElement;
    expect(processing.checked).toBe(true);
    expect(communications.checked).toBe(false);

    fireEvent.click(communications);
    expect(onCommunications).toHaveBeenCalledWith(true);
    expect(onProcessing).not.toHaveBeenCalled();
  });
});
