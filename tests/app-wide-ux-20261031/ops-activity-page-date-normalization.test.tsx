// @vitest-environment jsdom
//
// The Ops activity PAGE — one set of dates for the query and the screen
// (31 Oct 2026, revision).
//
// The activity log's links are shared. An old link carries an INSTANT
// ("2026-03-01T17:30:00+05:30"); the filter is a DATE filter now. The
// page must normalise the inbound value ONCE, and use the SAME
// normalised date for the read and for the controls the operator sees
// — otherwise the screen shows one day while the query asks about
// another, and an operator cannot tell which one they are looking at.
//
// A malformed bound must never fall through to an unfiltered read — and
// the refusal must still be AUDITED: every authenticated operation,
// including a refusal, passes through the audited activity list exactly
// once. The session is asked for first, whatever the bound says.
//
// The reader is the database layer behind the page (the real query), and
// the audit helper is the audited boundary. The page's own action and
// the platform session are the REAL ones: only the seams under them
// (the cookie, the session row, the reader and the audit writer) are
// replaced. So what this file asserts is the PAGE's behaviour: which
// boundary it goes through, and what it asks the reader for.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const activityMock = vi.hoisted(() => ({
  filters: [] as Array<Record<string, unknown>>,
}));

const opsMock = vi.hoisted(() => ({
  operations: [] as string[],
}));

const sessionMock = vi.hoisted(() => ({
  kind: "authenticated" as string,
}));

vi.mock("@/lib/auth/platform-cookie", () => ({
  readPlatformSessionToken: async () => "session-token",
  writePlatformSessionCookie: async () => {},
  clearPlatformSessionCookie: async () => {},
  platformSessionCookieMaxAgeSeconds: () => 3600,
  PLATFORM_COOKIE_NAME: "platform_session",
}));

vi.mock("@/db/platform-auth", () => ({
  platformLogin: async () => ({ ok: false, error: "unused" }),
  platformVerifyTotp: async () => ({ ok: false, error: "unused" }),
  lookupPlatformSession: async () => ({
    kind: sessionMock.kind,
    userId: "u1",
    role: "admin",
  }),
  platformLogoutWithResult: async () => ({ kind: "ok" }),
  PlatformAuthError: class PlatformAuthError extends Error {},
}));

vi.mock("@/lib/auth/ops-operation", () => ({
  runOpsRead: async (
    _operation: string,
    _tenantId: string,
    read: () => Promise<unknown>,
  ) => read(),
  runOpsGlobalRead: async (
    operation: string,
    read: () => Promise<unknown>,
  ) => {
    opsMock.operations.push(operation);
    return read();
  },
}));

vi.mock("@/db/platform-activity", () => {
  // The reader's own rule: a bound it cannot read is refused, never
  // rolled over into a different day.
  const realCalendarDate = (value: string): string | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return value;
  };
  const instantShape =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  const readable = (value: unknown): boolean => {
    if (value === undefined || value === null || value === "") return true;
    if (typeof value !== "string") return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return realCalendarDate(value) !== null;
    }
    if (!instantShape.test(value)) return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
    if (!parts) return false;
    return realCalendarDate(`${parts[1]}-${parts[2]}-${parts[3]}`) !== null;
  };
  return {
    listPlatformActivity: async (filter: Record<string, unknown>) => {
      activityMock.filters.push(filter);
      if (!readable(filter.since) || !readable(filter.until)) {
        throw new Error("That date filter is not a real date.");
      }
      return { rows: [], total: 0 };
    },
    listKnownActions: async () => ["tenant.activate"],
  };
});

vi.mock("@/db/platform-tenants", () => ({
  listAllTenantsForSelector: async () => [
    { id: "t1", name: "Aqua Worli", slug: "aqua-worli" },
  ],
}));

import PlatformActivityPage from "@/app/(platform)/ops/activity/page";

afterEach(() => {
  cleanup();
  activityMock.filters = [];
  opsMock.operations = [];
  sessionMock.kind = "authenticated";
});

describe("the Ops activity page — the query and the screen agree", () => {
  it("reads the IST dates the controls show", async () => {
    render(
      await PlatformActivityPage({
        searchParams: Promise.resolve({
          since: "2026-03-01T17:30:00+05:30",
          until: "2026-03-16T09:00:00+05:30",
        }),
      }),
    );

    expect(activityMock.filters[0]).toMatchObject({
      since: "2026-03-01",
      until: "2026-03-16",
    });
    expect(
      (screen.getByLabelText(/since date/i) as HTMLInputElement).value,
    ).toBe("01/03/2026");
    expect(
      (screen.getByLabelText(/until date/i) as HTMLInputElement).value,
    ).toBe("16/03/2026");
  });

  it("refuses a malformed bound instead of reading everything", async () => {
    await expect(
      PlatformActivityPage({
        searchParams: Promise.resolve({ since: "2026-02-30" }),
      }),
    ).rejects.toThrow();
    // The refusal must never become an UNFILTERED read: every read the
    // page attempted carried the bound that was refused.
    for (const filter of activityMock.filters) {
      expect(
        filter.since ?? filter.until,
        "a malformed bound was read as an unfiltered trail",
      ).toBeDefined();
    }
  });

  it("refuses a legacy instant whose local date does not exist", async () => {
    await expect(
      PlatformActivityPage({
        searchParams: Promise.resolve({ since: "2026-02-30T12:00:00+05:30" }),
      }),
    ).rejects.toThrow();
    for (const filter of activityMock.filters) {
      expect(
        filter.since ?? filter.until,
        "an impossible instant was read as an unfiltered trail",
      ).toBeDefined();
    }
  });

  it("records the refusal in the audited activity list, exactly once", async () => {
    await expect(
      PlatformActivityPage({
        searchParams: Promise.resolve({ since: "2026-02-30" }),
      }),
    ).rejects.toThrow();

    expect(
      opsMock.operations.filter((operation) => operation === "activity.list")
        .length,
      "the refusal did not pass through the audited activity list, so it was never audited",
    ).toBe(1);
  });

  it("reads the trail through the audited activity list", async () => {
    render(
      await PlatformActivityPage({
        searchParams: Promise.resolve({ since: "2026-03-01" }),
      }),
    );

    expect(
      opsMock.operations.filter((operation) => operation === "activity.list")
        .length,
      "the trail was not read through the audited activity list",
    ).toBe(1);
  });

  it("asks for the platform session before it reads anything", async () => {
    sessionMock.kind = "not_found";

    // The page sends an unauthenticated caller away; what matters here
    // is that it does so BEFORE it reads or audits anything.
    await expect(
      PlatformActivityPage({
        searchParams: Promise.resolve({ since: "2026-02-30" }),
      }),
    ).rejects.toThrow();

    expect(
      opsMock.operations,
      "an unauthenticated caller reached the audited read",
    ).toEqual([]);
    expect(
      activityMock.filters,
      "an unauthenticated caller read the trail",
    ).toEqual([]);
  });
});
