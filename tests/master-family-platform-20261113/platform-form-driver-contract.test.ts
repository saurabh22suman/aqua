import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Ops form leakage driver contract", () => {
  it("exercises the current native password form without depending on the retired WhatsApp door", () => {
    const source = readFileSync("scripts/e2e-platform-form-leak.ts", "utf8");
    expect(source).toContain('javaScriptEnabled: false');
    expect(source).toContain('input[name="email"]');
    expect(source).toContain('input[name="password"]');
    expect(source).toContain('loginForm.locator');
    expect(source).toContain('isVisible()');
    expect(source).toContain('$ACTION_');
    expect(source).toContain('loginCtx.request.post');
    expect(source).not.toContain('.fill(email)');
    expect(source).not.toContain('input[name="phone"]\').isDisabled()');
    expect(source).not.toContain('Send WhatsApp code');
    expect(source).toContain('seedAuthedSessionCookie()');
    expect(source).toContain('for (const t of FORM_TARGETS)');
  });
});
