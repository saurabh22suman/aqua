// @vitest-environment jsdom
// Shared custom dropdown — 30 October 2026.
//
// The two direct raw controls that were still outside the shared
// primitive. Once the shared select opens OUR listbox, a raw `<select>`
// still opens the operating system's own dropdown — so the switcher and
// the substitute picker move onto the shared control, and their own
// behaviour (the test ids, the accessible name, the change handler)
// has to survive the move.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  usePathname: () => "/owner/members",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/coach-substitution", () => ({
  substituteCoachAction: vi.fn(),
}));

import { FacilitySwitcher } from "@/components/facility-switcher";
import { SessionSubstituteControl } from "@/components/session-substitute-control";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LOCATIONS = [
  { id: "loc-1", name: "Worli Main" },
  { id: "loc-2", name: "Bandra Annex" },
];

describe("the facility switcher uses the shared select", () => {
  it("keeps its test id, its name and the shared picker metrics", () => {
    render(<FacilitySwitcher locations={LOCATIONS} />);
    const select = screen.getByTestId("facility-switcher");
    expect(select.tagName).toBe("SELECT");
    expect(select.getAttribute("aria-label") ?? select.id).toBeTruthy();
    expect(select.className).toContain("min-h-12");
    expect(select.className).toContain("rounded-ctl");
    expect(select.className).toContain("text-[16px]");
  });

  it("keeps the dropdown affordance the shared control draws", () => {
    render(<FacilitySwitcher locations={LOCATIONS} />);
    const chevron = screen.getByTestId("facility-switcher-chevron");
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
  });

  it("opens the shared listbox instead of the browser's own dropdown", () => {
    render(<FacilitySwitcher locations={LOCATIONS} />);
    fireEvent.keyDown(screen.getByTestId("facility-switcher"), { key: "ArrowDown" });
    const listbox = screen.getByRole("listbox");
    expect(
      Array.from(listbox.querySelectorAll('[role="option"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual(["All facilities", "Worli Main", "Bandra Annex"]);
  });

  it("still writes the choice to the URL and the cookie", () => {
    render(<FacilitySwitcher locations={LOCATIONS} />);
    fireEvent.change(screen.getByTestId("facility-switcher"), {
      target: { value: "loc-2" },
    });
    expect(push).toHaveBeenCalledWith("/owner/members?facility=loc-2");
    expect(document.cookie).toContain("aqua_facility=loc-2");
  });
});

describe("the substitute picker uses the shared select", () => {
  it("keeps its test id and the shared picker metrics", () => {
    render(
      <SessionSubstituteControl
        sessionId="s1"
        sessionDate="2026-10-30"
        startsAt="09:00"
        endsAt="10:00"
        currentCoachName="Asha Menon"
        coaches={[
          { staffId: "st-1", fullName: "Ravi Kumar" },
          { staffId: "st-2", fullName: "Asha Menon" },
        ]}
        onSubstituted={vi.fn()}
        terminology={{ locale: "en", overrides: {} }}
      />,
    );
    fireEvent.click(screen.getByTestId("substitute-open-s1"));
    const select = screen.getByTestId("substitute-coach-s1");
    expect(select.tagName).toBe("SELECT");
    expect(select.className).toContain("min-h-12");
    expect(select.className).toContain("rounded-ctl");
    expect(select.className).toContain("text-[16px]");
  });

  it("opens the shared listbox and reports the chosen coach", () => {
    render(
      <SessionSubstituteControl
        sessionId="s1"
        sessionDate="2026-10-30"
        startsAt="09:00"
        endsAt="10:00"
        currentCoachName="Asha Menon"
        coaches={[
          { staffId: "st-1", fullName: "Ravi Kumar" },
          { staffId: "st-2", fullName: "Asha Menon" },
        ]}
        onSubstituted={vi.fn()}
        terminology={{ locale: "en", overrides: {} }}
      />,
    );
    fireEvent.click(screen.getByTestId("substitute-open-s1"));
    const select = screen.getByTestId("substitute-coach-s1");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.change(select, { target: { value: "st-1" } });
    expect((select as HTMLSelectElement).value).toBe("st-1");
  });
});
