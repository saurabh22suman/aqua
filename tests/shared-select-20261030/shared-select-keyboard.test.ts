// @vitest-environment jsdom
// Shared custom dropdown — 30 October 2026.
//
// The popup's keyboard decisions are pure, so they are pinned here:
// a key and the state in, a decision out.
import { describe, expect, it } from "vitest";

import {
  enabledIndexes,
  matchByPrefix,
  nextEnabledIndex,
  popupKeyAction,
  typeaheadPrefix,
} from "@/components/ui/select-keyboard";
import type { SelectOption } from "@/components/ui/select-options";

const OPTIONS: SelectOption[] = [
  { value: "z", label: "Zebra", disabled: false, selected: false, group: null },
  { value: "cafe", label: "Cafe", disabled: false, selected: false, group: null },
  { value: "court", label: "Court", disabled: false, selected: false, group: null },
  { value: "cricket", label: "Cricket", disabled: false, selected: false, group: null },
  { value: "off", label: "Off", disabled: true, selected: false, group: null },
];

describe("the typed prefix", () => {
  it("extends the prefix, so 'c' then 'o' is 'co'", () => {
    const first = typeaheadPrefix({ text: "", at: 0 }, "c", 1000, 800);
    expect(first).toBe("c");
    const second = typeaheadPrefix({ text: first, at: 1000 }, "o", 1100, 800);
    expect(second).toBe("co");
  });

  it("starts again when the same letter is typed twice", () => {
    const first = typeaheadPrefix({ text: "", at: 0 }, "c", 1000, 800);
    const second = typeaheadPrefix({ text: first, at: 1000 }, "c", 1100, 800);
    expect(second).toBe("c");
  });

  it("starts again after a pause", () => {
    const first = typeaheadPrefix({ text: "", at: 0 }, "c", 1000, 800);
    const second = typeaheadPrefix({ text: first, at: 1000 }, "o", 2000, 800);
    expect(second).toBe("o");
  });

  it("finds the option the prefix names", () => {
    expect(matchByPrefix(OPTIONS, "co", 0)).toBe(2);
    expect(matchByPrefix(OPTIONS, "cri", 0)).toBe(3);
    expect(matchByPrefix(OPTIONS, "zz", 0)).toBe(-1);
  });

  it("never lands on a disabled option", () => {
    expect(matchByPrefix(OPTIONS, "off", 0)).toBe(-1);
    expect(enabledIndexes(OPTIONS)).toEqual([0, 1, 2, 3]);
    expect(nextEnabledIndex(OPTIONS, 3, 1)).toBe(0);
  });
});

describe("the key model", () => {
  it("closes the popup on Escape and swallows the key", () => {
    expect(popupKeyAction("Escape")).toEqual({ kind: "close", swallow: true });
  });

  it("closes the popup on Tab but lets the key go on", () => {
    expect(popupKeyAction("Tab")).toEqual({ kind: "close", swallow: false });
  });

  it("walks, jumps and chooses", () => {
    expect(popupKeyAction("ArrowDown")).toEqual({ kind: "move", direction: 1 });
    expect(popupKeyAction("ArrowUp")).toEqual({ kind: "move", direction: -1 });
    expect(popupKeyAction("Home")).toEqual({ kind: "edge", edge: "first" });
    expect(popupKeyAction("End")).toEqual({ kind: "edge", edge: "last" });
    expect(popupKeyAction("Enter")).toEqual({ kind: "choose" });
    expect(popupKeyAction(" ")).toEqual({ kind: "choose" });
  });

  it("treats a printable character as the typeahead", () => {
    expect(popupKeyAction("c")).toEqual({ kind: "typeahead", character: "c" });
  });

  it("leaves the keys that are not the popup's alone", () => {
    expect(popupKeyAction("Shift")).toBeNull();
    expect(popupKeyAction("F5")).toBeNull();
  });
});
