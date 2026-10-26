// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { isSafeToReload, unsavedInputCount } from "@/lib/offline/update-safety";

// What counts as work an update must not throw away
// (docs/design-system/pwa.md: "Version/update UX must protect unsaved
// input and pending attendance").
//
// Agent-owned file (tests/pwa/**).

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("unsaved input", () => {
  it("ignores an empty form", () => {
    document.body.innerHTML = `<form><input name="a" /><textarea></textarea></form>`;
    expect(unsavedInputCount()).toBe(0);
  });

  it("counts a field the person has typed into", () => {
    document.body.innerHTML = `<form><input name="a" value="Priya" /></form>`;
    expect(unsavedInputCount()).toBe(1);
  });

  it("counts a textarea the person has typed into", () => {
    document.body.innerHTML = `<form><textarea>Rs 1200</textarea></form>`;
    expect(unsavedInputCount()).toBe(1);
  });

  it("counts a checkbox the person has changed away from the server's state", () => {
    document.body.innerHTML = `<form><input type="checkbox" checked /></form>`;
    const box = document.querySelector("input") as HTMLInputElement;
    expect(unsavedInputCount()).toBe(0);
    box.checked = false;
    expect(unsavedInputCount()).toBe(1);
  });

  it("counts a select the person has changed away from the rendered choice", () => {
    document.body.innerHTML = `<form><select><option value="1">One</option><option value="2" selected>Two</option></select></form>`;
    const select = document.querySelector("select") as HTMLSelectElement;
    expect(unsavedInputCount()).toBe(0);
    select.value = "1";
    expect(unsavedInputCount()).toBe(1);
  });

  it("ignores hidden fields and fields explicitly marked as disposable", () => {
    document.body.innerHTML = `<form><input type="hidden" value="csrf" /><input name="q" value="search" data-pwa-dirty="false" /></form>`;
    expect(unsavedInputCount()).toBe(0);
  });

  it("counts editable content that is not a form field", () => {
    document.body.innerHTML = `<div contenteditable="true">Annual fee note</div>`;
    expect(unsavedInputCount()).toBe(1);
  });
});

describe("reload safety", () => {
  it("is safe only when nothing is pending", () => {
    expect(isSafeToReload({ pendingAttendance: 0, unsavedInputs: 0 })).toBe(true);
    expect(isSafeToReload({ pendingAttendance: 2, unsavedInputs: 0 })).toBe(false);
    expect(isSafeToReload({ pendingAttendance: 0, unsavedInputs: 1 })).toBe(false);
  });

  it("is not safe when the storage could not be read", () => {
    // -1 means "unknown" — an unreadable queue must never be treated as
    // an empty queue.
    expect(isSafeToReload({ pendingAttendance: -1, unsavedInputs: 0 })).toBe(false);
  });
});
