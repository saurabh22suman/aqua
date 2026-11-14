// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ roster: vi.fn(), identity: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireCoach: async () => ({}) }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ({ tenantId: "tenant-a", userId: "user-a", roleKey: "coach" }) }));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: () => {} }));
vi.mock("@/lib/services/register", () => ({ getRosterForSession: state.roster }));
vi.mock("@/lib/offline/server-session", () => ({ offlineSessionState: state.identity }));
vi.mock("@/lib/feature-flags", () => ({ OFFLINE_SYNC_ENABLED: true }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ overrides: {}, locale: "en" }) }));
vi.mock("@/components/register-board", () => ({ RegisterBoard: () => <div>Attendance roster</div> }));

import { getRosterAction } from "@/lib/actions/coach";
import RegisterPage from "@/app/(coach)/coach/register/[sessionId]/page";

const id = "11111111-1111-4111-8111-111111111111";
const roster = { batchName: "Morning", locationName: "North Hall", startsAt: new Date("2026-11-13T02:00:00Z"), rows: [], offlineSyncEnabled: true };
afterEach(() => { cleanup(); state.roster.mockReset(); state.identity.mockReset(); });

it("forwards the authorized venue and preserves offline identity", async () => {
  state.roster.mockResolvedValue(roster);
  state.identity.mockResolvedValue({ identity: { scope: "original-scope" } });
  expect(await getRosterAction(id)).toMatchObject({ locationName: "North Hall", offlineIdentity: { scope: "original-scope" } });
});

it("shows the venue before the roster when opening the register directly", async () => {
  state.roster.mockResolvedValue(roster);
  state.identity.mockResolvedValue({ identity: null });
  render(await RegisterPage({ params: Promise.resolve({ sessionId: id }) }));
  const venue = screen.getByText(/North Hall/);
  expect(venue.compareDocumentPosition(screen.getByText("Attendance roster")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("handles an unconfigured venue without inventing one", async () => {
  state.roster.mockResolvedValue({ ...roster, locationName: null, offlineSyncEnabled: false });
  render(await RegisterPage({ params: Promise.resolve({ sessionId: id }) }));
  expect(screen.getByText(/venue not recorded/i)).toBeTruthy();
  expect(state.identity).not.toHaveBeenCalled();
});

it("does not reveal a venue for a denied or missing session", async () => {
  state.roster.mockResolvedValue(null);
  render(await RegisterPage({ params: Promise.resolve({ sessionId: id }) }));
  expect(screen.getByText(/not found/i)).toBeTruthy();
  expect(screen.queryByText(/North Hall/)).toBeNull();
  expect(state.identity).not.toHaveBeenCalled();
});
