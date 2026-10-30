// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  parseMembersListNavigation,
  readMembersListNavigation,
  writeMembersListNavigation,
} from "@/components/members-list-navigation";

const KEY = "tenant-1:user-1";
const LOCATION = "loc-1";

function state(overrides: Record<string, unknown> = {}) {
  return {
    namespace: KEY,
    locationId: LOCATION,
    search: "e",
    status: "active",
    scrollY: 770,
    ...overrides,
  };
}

describe("members list history state", () => {
  it("accepts the current tenant/actor namespace and facility", () => {
    expect(parseMembersListNavigation(state(), KEY, LOCATION)).toEqual(state());
  });

  it("discards account/tenant, facility and malformed state", () => {
    expect(parseMembersListNavigation(state({ namespace: "other" }), KEY, LOCATION)).toBeNull();
    expect(parseMembersListNavigation(state({ locationId: "loc-2" }), KEY, LOCATION)).toBeNull();
    expect(parseMembersListNavigation(null, KEY, LOCATION)).toBeNull();
    expect(parseMembersListNavigation(state({ search: 42 }), KEY, LOCATION)).toBeNull();
    expect(parseMembersListNavigation(state({ search: "x".repeat(201) }), KEY, LOCATION)).toBeNull();
    expect(parseMembersListNavigation(state({ status: null }), KEY, LOCATION)).toBeNull();
    expect(parseMembersListNavigation(state({ status: "bogus" }), KEY, LOCATION)).toBeNull();
    expect(parseMembersListNavigation(state({ scrollY: Number.NaN }), KEY, LOCATION)).toBeNull();
    expect(parseMembersListNavigation(state({ scrollY: -1 }), KEY, LOCATION)).toBeNull();
  });

  it("reads and writes only the current history entry without adding a URL query", () => {
    window.history.replaceState({}, "", "/owner/members");
    writeMembersListNavigation(state());
    expect(readMembersListNavigation(KEY, LOCATION)).toEqual(state());
    expect(window.location.search).toBe("");
    expect(window.history.length).toBe(1);
  });
});
