// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const { policy } = vi.hoisted(() => ({ policy: { OPS_STAGING_PASSWORD_ONLY: false } }));
vi.mock("@/lib/env", () => ({ env: policy }));
vi.mock("@/lib/actions/platform-auth", () => ({ platformAuthStatusAction: async () => ({ kind: "not_found" }) }));
vi.mock("@/app/(platform)/ops/login/login-form", () => ({ PlatformLoginForm: () => <div>Operator login form</div> }));
import Page from "@/app/(platform)/ops/login/page";
afterEach(cleanup);
describe("Ops sign-in policy copy", () => {
  it("describes password-only staging sign-in when validated policy is enabled", async () => {
    policy.OPS_STAGING_PASSWORD_ONLY = true;
    render(await Page());
    expect(screen.getByText("Staging sign-in uses your operator password only.")).toBeTruthy();
    expect(screen.queryByText(/then confirm with your authenticator code/)).toBeNull();
    expect(screen.getByText("Operator login form")).toBeTruthy();
  });
  it("preserves the authenticator instruction when disabled", async () => {
    policy.OPS_STAGING_PASSWORD_ONLY = false;
    render(await Page());
    expect(screen.getByText("Use your operator password, then confirm with your authenticator code.")).toBeTruthy();
  });
});
