import { describe, expect, it, vi } from "vitest";

// P0-1 (mobile UX audit, 2026-09-12) — every dynamic route parsed the
// URL segment inside a Zod `.parse()` in the action, so a malformed
// segment ("INVALID-ID", or even a member code like "AWS-010") threw a
// raw ZodError. In dev that renders Next's error overlay with the full
// pattern and stack; in production there is no error.tsx, so it is
// Next's default "Application error" page. The fix is a page-level
// UUID guard that turns the bad segment into the normal friendly 404
// BEFORE the action is called.
//
// These tests drive the real page modules with the surface guard and
// every action mocked. For an invalid id no action may run; the page
// must reject with the Next notFound signal.
//
// Mutation proof: deleting `requireUuidParam(...)` from any page makes
// the action mock throw `ACTION_CALLED` and flips these red.

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({}),
  requireReception: async () => ({}),
  requireCoach: async () => ({}),
}));

const { failIfCalled } = vi.hoisted(() => ({
  failIfCalled: (name: string) =>
    vi.fn(() => {
      throw new Error(`ACTION_CALLED: ${name}`);
    }),
}));

vi.mock("@/lib/actions/people", () => ({
  getMemberDetailAction: failIfCalled("getMemberDetailAction"),
  getMemberIdCardContextAction: failIfCalled("getMemberIdCardContextAction"),
  listLocationsAction: failIfCalled("listLocationsAction"),
}));
vi.mock("@/lib/actions/attendance", () => ({
  getMemberAttendanceHistoryAction: failIfCalled("getMemberAttendanceHistoryAction"),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: failIfCalled("getTerminologyAction"),
}));
vi.mock("@/lib/actions/coach", () => ({
  getCoachMemberDetailAction: failIfCalled("getCoachMemberDetailAction"),
  getRosterAction: failIfCalled("getRosterAction"),
}));
vi.mock("@/lib/actions/enquiries", () => ({
  getEnquiryDetailAction: failIfCalled("getEnquiryDetailAction"),
  addFollowUpAction: vi.fn(),
  bookTrialAction: vi.fn(),
  completeFollowUpAction: vi.fn(),
  convertEnquiryAction: vi.fn(),
  transitionEnquiryStageAction: vi.fn(),
}));
vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: failIfCalled("listBatchesAction"),
}));
vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({ kind: "authenticated", role: "operator" }),
}));
vi.mock("@/db/platform-tenants", () => ({
  getTenantDetail: failIfCalled("getTenantDetail"),
}));
vi.mock("@/db/sample-data-state", () => ({
  getSampleDataState: failIfCalled("getSampleDataState"),
}));

import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";
import EditMemberPage from "@/app/(owner)/owner/members/[memberId]/edit/page";
import ReceptionMemberDetailPage from "@/app/(reception)/reception/members/[memberId]/page";
import CoachMemberDetailPage from "@/app/(coach)/coach/members/[memberId]/page";
import RegisterPage from "@/app/(coach)/coach/register/[sessionId]/page";
import EnquiryDetailPage from "@/app/(owner)/owner/enquiries/[enquiryId]/page";
import ReceptionEnquiryDetailPage from "@/app/(reception)/reception/enquiries/[enquiryId]/page";
import PlatformTenantDetailPage from "@/app/(platform)/ops/tenants/[tenantId]/page";

import {
  getMemberDetailAction,
  getMemberIdCardContextAction,
  listLocationsAction,
} from "@/lib/actions/people";
import { getMemberAttendanceHistoryAction } from "@/lib/actions/attendance";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getCoachMemberDetailAction, getRosterAction } from "@/lib/actions/coach";
import { getEnquiryDetailAction } from "@/lib/actions/enquiries";
import { listBatchesAction } from "@/lib/actions/programs";
import { getTenantDetail } from "@/db/platform-tenants";
import { getSampleDataState } from "@/db/sample-data-state";

const BAD_IDS = ["INVALID-ID", "AWS-010", "not-a-uuid"];

describe("requireUuidParam", () => {
  it("passes a valid v7 UUID through unchanged", async () => {
    const { requireUuidParam } = await import("@/lib/params");
    const id = "01a0947a-0a5e-72eb-94d4-d4a60d7d1bc2";
    expect(requireUuidParam(id)).toBe(id);
  });

  it.each(BAD_IDS)("rejects %s with notFound", async (value) => {
    const { requireUuidParam } = await import("@/lib/params");
    expect(() => requireUuidParam(value)).toThrow("NEXT_NOT_FOUND");
  });
});

describe("malformed URL ids render the friendly 404, never a ZodError (P0-1)", () => {
  it.each(BAD_IDS)("owner member detail rejects %s with notFound", async (memberId) => {
    await expect(
      MemberDetailPage({ params: Promise.resolve({ memberId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(BAD_IDS)("owner member edit rejects %s with notFound", async (memberId) => {
    await expect(
      EditMemberPage({ params: Promise.resolve({ memberId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(BAD_IDS)("reception member detail rejects %s with notFound", async (memberId) => {
    await expect(
      ReceptionMemberDetailPage({ params: Promise.resolve({ memberId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(BAD_IDS)("coach member detail rejects %s with notFound", async (memberId) => {
    await expect(
      CoachMemberDetailPage({ params: Promise.resolve({ memberId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(BAD_IDS)("coach register rejects %s with notFound", async (sessionId) => {
    await expect(
      RegisterPage({ params: Promise.resolve({ sessionId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(BAD_IDS)("owner enquiry detail rejects %s with notFound", async (enquiryId) => {
    await expect(
      EnquiryDetailPage({ params: Promise.resolve({ enquiryId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(BAD_IDS)("reception enquiry detail rejects %s with notFound", async (enquiryId) => {
    await expect(
      ReceptionEnquiryDetailPage({ params: Promise.resolve({ enquiryId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(BAD_IDS)("ops tenant detail rejects %s with notFound", async (tenantId) => {
    await expect(
      PlatformTenantDetailPage({ params: Promise.resolve({ tenantId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("never reaches any action on a malformed id", () => {
    for (const action of [
      getMemberDetailAction,
      getMemberIdCardContextAction,
      listLocationsAction,
      getMemberAttendanceHistoryAction,
      getTerminologyAction,
      getCoachMemberDetailAction,
      getRosterAction,
      getEnquiryDetailAction,
      listBatchesAction,
      getTenantDetail,
      getSampleDataState,
    ]) {
      expect(action).not.toHaveBeenCalled();
    }
  });
});
