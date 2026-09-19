import { describe, expect, it } from "vitest";
import {
  signPremisesQrToken,
  verifyPremisesQrToken,
} from "@/lib/services/premises-qr";
import { v7 as uuidv7 } from "uuid";

// V-25 — the premises QR token. Public by design (it hangs on a wall),
// so the properties that matter are: it round-trips, a tampered
// payload or signature is rejected, and an expired token is rejected.
// The scanning staff member's session is the actual credential; the
// route also checks the token's tenant against the session tenant.

describe("premises QR token (V-25)", () => {
  it("round-trips the tenant and scope", () => {
    const tenantId = uuidv7();
    const { token } = signPremisesQrToken({ tenantId });
    const claims = verifyPremisesQrToken(token);
    expect(claims?.tenantId).toBe(tenantId);
    expect(claims?.scope).toBe("premises_check_in");
  });

  it("rejects a tampered payload", () => {
    const { token } = signPremisesQrToken({ tenantId: uuidv7() });
    const [header, , sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        tenantId: uuidv7(),
        scope: "premises_check_in",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        jti: "forged",
      }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(verifyPremisesQrToken(`${header}.${forged}.${sig}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const { token } = signPremisesQrToken({ tenantId: uuidv7() });
    const parts = token.split(".");
    expect(verifyPremisesQrToken(`${parts[0]}.${parts[1]}.AAAA`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const { token } = signPremisesQrToken({
      tenantId: uuidv7(),
      ttlSeconds: -10,
    });
    expect(verifyPremisesQrToken(token)).toBeNull();
  });

  it("rejects garbage without throwing", () => {
    expect(verifyPremisesQrToken("not-a-token")).toBeNull();
    expect(verifyPremisesQrToken("")).toBeNull();
  });
});
