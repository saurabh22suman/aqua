import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENDA_ITEM_TESTID,
  AGENDA_LIST_TESTID,
  AGENDA_VIEW_CONTAINER_TESTID,
  MEMBER_ROW_LINK_SELECTOR as CAPTURE_MEMBER_ROW_SELECTOR,
  isMemberDetailPath,
  mobileNavigationPass,
  settingsDenialPass,
  type MobileNavSnapshot,
} from "./capture-owner";
import {
  assessObstructions,
  assessPhoneCharts,
  assessTimeFieldGroup,
  clipRectToViewport,
  focusMatchesOpener,
  isTextEntryControl,
  largestLabelTarget,
  meetsMinimumTarget,
  MEMBER_ROW_LINK_SELECTOR as MOBILE_MEMBER_ROW_SELECTOR,
  normaliseMobileFixture,
  overlapArea,
  resolveAccessibleLabel,
  type ChartState,
  type ObstructionCandidate,
  type TimeFieldGroupReading,
} from "./mobile-qa";

const ID = "01a184db-58e1-76cd-8233-2904f52af0f7";

// Observed on the frozen 7b0de source:
// - mobile shared: 7 member-detail captures BLOCKED because the resolver
//   stored the full href and produced /owner/members//owner/members/<uuid>.
// - MOB-09 and shell back-scroll: locator timed out on
//   [data-testid="member-row"] a; the row itself is the anchor.
// - shell/responsive: the zero-height wrapper was reported as the mobile nav
//   even though the real fixed <nav> rendered.
// - agenda: 26 items rendered, but a multi-match isVisible() on the per-day
//   lists reported the container absent.
// - MOB-10: focus was never restored because the opener was clicked
//   programmatically without focusing it.
// - permission: /owner/settings rendered the not-found boundary with HTTP 200.

describe("reviewer QA driver contracts", () => {
  it("reduces a captured member href to the UUID segment the route needs", () => {
    expect(normaliseMobileFixture(`/owner/members/${ID}`)).toBe(ID);
    expect(normaliseMobileFixture(`http://127.0.0.1:3275/owner/members/${ID}`)).toBe(
      ID,
    );
    expect(normaliseMobileFixture("/owner/members/not-a-uuid")).toBeNull();
    expect(normaliseMobileFixture(null)).toBeNull();
  });

  it("opens the member row itself because the row is the anchor", () => {
    expect(CAPTURE_MEMBER_ROW_SELECTOR).toBe('[data-testid="member-row"]');
    expect(MOBILE_MEMBER_ROW_SELECTOR).toBe('[data-testid="member-row"]');
  });

  it("uses the rendered fixed nav and proves its links are reachable", () => {
    const links = Array.from({ length: 5 }, () => ({
      visible: true,
      reachable: true,
      height: 64,
    }));
    const rendered: MobileNavSnapshot = {
      wrapperWidth: 390,
      wrapperHeight: 0,
      bar: {
        visible: true,
        position: "fixed",
        insideViewport: true,
        bottomAligned: true,
        links,
      },
    };

    expect(mobileNavigationPass(false, rendered)).toBe(true);
    expect(
      mobileNavigationPass(false, {
        ...rendered,
        bar: { ...rendered.bar!, links: [...links.slice(1), { ...links[0]!, reachable: false }] },
      }),
    ).toBe(false);
    expect(mobileNavigationPass(false, { ...rendered, bar: null })).toBe(false);
    expect(
      mobileNavigationPass(true, {
        wrapperWidth: 0,
        wrapperHeight: 0,
        bar: null,
      }),
    ).toBe(true);
    expect(mobileNavigationPass(true, rendered)).toBe(false);
  });

  it("targets the semantic agenda day container, not an absent single list", () => {
    expect(AGENDA_VIEW_CONTAINER_TESTID).toBe("calendar-agenda-days");
    expect(AGENDA_LIST_TESTID).toBe("calendar-agenda");
    expect(AGENDA_ITEM_TESTID).toBe("calendar-agenda-item");
  });

  it("restores focus to the exact calendar opener", () => {
    const opener = { testId: "calendar-event", eventId: "event-a" };
    expect(
      focusMatchesOpener({ testId: "calendar-event", eventId: "event-b" }, opener),
    ).toBe(false);
    expect(focusMatchesOpener({ ...opener }, opener)).toBe(true);
    expect(focusMatchesOpener(null, opener)).toBe(false);
  });

  it("opens the dialog with a real locator click, never a programmatic click", () => {
    const source = readFileSync(
      join(process.cwd(), "tests/owner-openpen-20261029/reviewer/mobile-qa.ts"),
      "utf8",
    );
    expect(source).not.toContain("nodes[0]?.click()");
    expect(source).not.toContain("first.click()");
    expect(source).toContain("data-event-id");
  });

  it("accepts a wrapping implicit label and keeps accessible-name precedence", () => {
    expect(
      resolveAccessibleLabel({
        labelledBy: "",
        ariaLabel: null,
        labels: ["Search"],
      }),
    ).toBe("Search");
    expect(
      resolveAccessibleLabel({
        labelledBy: "Visible label",
        ariaLabel: "Aria label",
        labels: ["Native label"],
      }),
    ).toBe("Visible label");
    expect(
      resolveAccessibleLabel({
        labelledBy: "",
        ariaLabel: "Aria label",
        labels: ["Native label"],
      }),
    ).toBe("Aria label");
    const source = readFileSync(
      join(process.cwd(), "tests/owner-openpen-20261029/reviewer/mobile-qa.ts"),
      "utf8",
    );
    expect(source).toContain("labelsProperty.labels");
    expect(source).toContain(".closest(\"label\")");
  });

  it("clips offscreen rects before an overlap can be reported", () => {
    const viewport = { width: 320, height: 844 };
    expect(
      clipRectToViewport(
        { x: 0, y: 900, width: 100, height: 100, bottom: 1000, right: 100 },
        viewport,
      ),
    ).toBeNull();
    const first = clipRectToViewport(
      { x: 0, y: 800, width: 100, height: 100, bottom: 900, right: 100 },
      viewport,
    );
    const second = clipRectToViewport(
      { x: 50, y: 800, width: 100, height: 100, bottom: 900, right: 150 },
      viewport,
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(overlapArea(first!, second!)).toBeGreaterThan(16);
    const source = readFileSync(
      join(process.cwd(), "tests/owner-openpen-20261029/reviewer/mobile-qa.ts"),
      "utf8",
    );
    expect(source).toContain("document.elementFromPoint");
    expect(source).toContain("style.overflowX");
    expect(source).toContain("probePageEnd");
  });

  it("accepts an empty Day only with real Month charts or the honest empty state", () => {
    const chart = {
      testId: "owner-mini-chart",
      role: "img",
      ariaLabel: "Collections by payment group for Month",
      width: 300,
      height: 128,
    };
    const day: ChartState = {
      charts: [],
      moneyText: "No payments captured in this period.",
      period: "day",
    };
    const monthWithChart: ChartState = {
      charts: [chart],
      moneyText: "Collections ₹1,00,000",
      period: "month",
    };
    expect(assessPhoneCharts(day, monthWithChart).pass).toBe(true);
    expect(
      assessPhoneCharts(day, {
        charts: [],
        moneyText: "No collections in this period, so there is no mix to draw.",
        period: "month",
      }).pass,
    ).toBe(true);
    expect(
      assessPhoneCharts(day, {
        charts: [],
        moneyText: "Club overview",
        period: "month",
      }).pass,
    ).toBe(false);
    expect(
      assessPhoneCharts(
        { ...day, charts: [chart] },
        null,
      ).pass,
    ).toBe(true);
    expect(assessPhoneCharts(day, null).pass).toBeNull();
  });

  it("waits for the exact member detail URL, not the members-list h1", () => {
    expect(isMemberDetailPath(`/owner/members/${ID}`)).toBe(true);
    expect(isMemberDetailPath(`/owner/members/${ID}/`)).toBe(true);
    expect(isMemberDetailPath("/owner/members")).toBe(false);
    expect(isMemberDetailPath("/owner/members/new")).toBe(false);
    expect(isMemberDetailPath(`/owner/members/${ID}/edit`)).toBe(false);
  });

  it("uses the checkbox label hit target and limits text-entry metrics", () => {
    const target = largestLabelTarget([
      { x: 31, y: 2046, width: 328, height: 56, bottom: 2102, right: 359 },
    ]);
    expect(target).not.toBeNull();
    expect(target!.rect.height).toBe(56);
    expect(target!.kind).toBe("label");
    expect(meetsMinimumTarget(target!.rect)).toBe(true);
    expect(meetsMinimumTarget({ width: 44, height: 44 })).toBe(true);
    expect(meetsMinimumTarget({ width: 20, height: 60 })).toBe(false);
    expect(meetsMinimumTarget({ width: 60, height: 20 })).toBe(false);
    expect(meetsMinimumTarget({ width: 43, height: 44 })).toBe(false);
    expect(isTextEntryControl("input", "text")).toBe(true);
    expect(isTextEntryControl("input", "date")).toBe(true);
    expect(isTextEntryControl("input", "")).toBe(true);
    expect(isTextEntryControl("select", "")).toBe(true);
    expect(isTextEntryControl("textarea", "")).toBe(true);
    expect(isTextEntryControl("input", "checkbox")).toBe(false);
    expect(isTextEntryControl("input", "radio")).toBe(false);
    expect(isTextEntryControl("button", "")).toBe(false);
  });

  it("distinguishes a cleared sticky header from a permanently trapped footer", () => {
    const candidates: ObstructionCandidate[] = [
      {
        text: "Open the transactions",
        overlay: "topbar",
        overlayAfter: "none",
        hit: "a",
        pointerInside: true,
        focusLanded: true,
        disabled: false,
      },
      {
        text: "Last action",
        overlay: "nav",
        overlayAfter: "nav",
        hit: "nav",
        pointerInside: false,
        focusLanded: true,
        disabled: false,
      },
      {
        text: "Disabled clear",
        overlay: "topbar",
        overlayAfter: "none",
        hit: "button",
        pointerInside: true,
        focusLanded: false,
        disabled: true,
      },
      {
        text: "Disabled trapped",
        overlay: "nav",
        overlayAfter: "nav",
        hit: "nav",
        pointerInside: false,
        focusLanded: false,
        disabled: true,
      },
      {
        text: "Keyboard blocked",
        overlay: "topbar",
        overlayAfter: "none",
        hit: "input",
        pointerInside: true,
        focusLanded: false,
        disabled: false,
      },
    ];
    const result = assessObstructions(candidates);
    expect(result.cleared.map((item) => item.text)).toEqual([
      "Open the transactions",
      "Disabled clear",
    ]);
    expect(result.permanent.map((item) => item.text)).toEqual([
      "Last action",
      "Disabled trapped",
      "Keyboard blocked",
    ]);
    const source = readFileSync(
      join(process.cwd(), "tests/owner-openpen-20261029/reviewer/mobile-qa.ts"),
      "utf8",
    );
    expect(source).toContain("checkVisibility");
    expect(source).toContain("scrollIntoView");
    expect(source).toContain("pointerInside");
    expect(source).toContain("overlayAfter");
    expect(source).toContain("disabled");
  });

  it("requires the visible TimeField select group, not a native time input", () => {
    const select = {
      label: "Hour",
      visible: true,
      width: 282,
      height: 48,
      fontSize: 16,
      radius: "10px",
      associated: 1,
      hit: "select",
    };
    const good: TimeFieldGroupReading = {
      legend: "Start",
      visible: true,
      nativeTimeInputs: 0,
      ariaInvalid: null,
      ariaRequired: null,
      options: {
        hour: ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))],
        minute: [
          "",
          ...Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")),
        ],
        period: ["", "AM", "PM"],
      },
      selects: [
        select,
        { ...select, label: "Minutes" },
        { ...select, label: "AM/PM" },
      ],
      interaction: {
        attempted: false,
        skippedReason: "disabled",
        original: ["6", "00", "AM"],
        selected: [],
        restored: ["6", "00", "AM"],
      },
    };
    expect(assessTimeFieldGroup(good).pass).toBe(true);
    const original = ["6", "00", "AM"];
    expect(
      assessTimeFieldGroup({
        ...good,
        interaction: {
          attempted: true,
          original,
          selected: ["9", "30", "PM"],
          restored: original,
        },
      }).pass,
    ).toBe(true);
    expect(
      assessTimeFieldGroup({
        ...good,
        interaction: {
          attempted: true,
          original,
          selected: ["6", "30", "PM"],
          restored: original,
        },
      }).pass,
    ).toBe(false);
    expect(
      assessTimeFieldGroup({
        ...good,
        interaction: {
          attempted: true,
          original,
          selected: ["9", "00", "PM"],
          restored: original,
        },
      }).pass,
    ).toBe(false);
    expect(
      assessTimeFieldGroup({
        ...good,
        interaction: {
          attempted: true,
          original,
          selected: ["9", "30", "PM"],
          restored: original,
          error: "select failed",
        },
      }).pass,
    ).toBe(false);
    expect(
      assessTimeFieldGroup({
        ...good,
        nativeTimeInputs: 1,
      }).pass,
    ).toBe(false);
    expect(
      assessTimeFieldGroup({
        ...good,
        selects: [{ ...select, height: 46 }, good.selects[1]!, good.selects[2]!],
      }).pass,
    ).toBe(false);
    expect(
      assessTimeFieldGroup({
        ...good,
        selects: [{ ...select, width: 40 }, good.selects[1]!, good.selects[2]!],
      }).pass,
    ).toBe(false);
    expect(
      assessTimeFieldGroup({
        ...good,
        selects: [{ ...select, height: 47.6 }, good.selects[1]!, good.selects[2]!],
      }).pass,
    ).toBe(true);
    expect(
      assessTimeFieldGroup({
        ...good,
        selects: [{ ...select, radius: "9999px" }, good.selects[1]!, good.selects[2]!],
      }).pass,
    ).toBe(false);
    expect(
      assessTimeFieldGroup({
        ...good,
        interaction: {
          attempted: true,
          original: ["6", "00", "AM"],
          selected: ["9", "30", "AM"],
          restored: ["6", "00", "AM"],
        },
      }).pass,
    ).toBe(false);
  });

  it("accepts only a safe rendered settings denial, not status alone", () => {
    expect(
      settingsDenialPass({
        status: 404,
        body: "We couldn't find that page",
        settingsLinks: 0,
      }),
    ).toBe(true);
    expect(
      settingsDenialPass({
        status: 200,
        body: "We couldn’t find that page. Go to sign in",
        settingsLinks: 0,
      }),
    ).toBe(true);
    expect(
      settingsDenialPass({
        status: 200,
        body: "This page could not be found. Go to sign in",
        settingsLinks: 0,
      }),
    ).toBe(true);
    expect(
      settingsDenialPass({
        status: 404,
        body: "Settings categories Academy profile",
        settingsLinks: 2,
      }),
    ).toBe(false);
    expect(
      settingsDenialPass({ status: 200, body: "Club overview", settingsLinks: 1 }),
    ).toBe(false);
  });
});
