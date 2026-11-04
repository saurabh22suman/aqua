// @vitest-environment node
//
// Lane a-auth — Task A: the PIN-recovery route must not answer a caller with
// an arbitrary internal Error.message.
//
// THE DEFECT (protected file, proposal-only fix)
// `lib/auth/whatsapp-route.ts` ends with:
//
//   } catch (error) {
//     return reply({ step: ..., error: error instanceof Error ? error.message : "..." });
//   }
//
// The catch wraps `issueWhatsAppChallenge`, `verifyPinResetCode` and
// `saveResetPin`. Anything they throw is copied verbatim to an
// UNAUTHENTICATED caller — for example
//   "Authentication secret is not configured."
//   "connect ECONNREFUSED 127.0.0.1:5432"
// or a driver message that quotes the connection. The client cannot repair
// that: it is a protected file and needs the human approval the original
// audit requires.
//
// THE CONTRACT THIS FILE PINS
//   * an UNEXPECTED failure (any Error, or a non-Error throw) is answered
//     `503` with exactly one fixed sentence — the outcome is unknown. No
//     internal detail, and no blanket "Try again" that would invite a blind
//     repeat of a write that may already have committed.
//   * the three DELIBERATE refusals the services throw on purpose are kept
//     verbatim, with today's `200 {step, error}` shape, so the operator
//     still sees "Enter a valid mobile number.", "WhatsApp is unavailable.
//     Please try again later." and "Please wait before requesting another
//     code." exactly as before.
//   * the invalid-origin refusal, the Ops refusal (every Ops WhatsApp login
//     path stays refused) and the generic account-existence answer are
//     unchanged.
//
// THIS TEST IS THE INTENDED RED. It is deliberately left failing until the
// protected change is approved and applied; the ordinary UI checks are
// reported separately from it.

import { describe, expect, it, vi, beforeEach } from "vitest";

const SENTINEL = "AQUA_FAKE_INTERNAL_DETAIL_7c1d9f";
// The one sentence an unexpected failure may answer with. It states the
// outcome is unknown and never invites a repeat of the same request: at the
// save phase a blind repeat is a blind reset retry.
const UNCERTAIN_ANSWER = "We could not confirm the outcome of this request.";
// The blanket answer the route gives today for a non-Error throw. It is the
// second half of the defect: it invites a repeat of an unconfirmed write.
const BLANKET_ANSWER = "Unable to complete this request. Try again.";
// The only three messages this pre-auth route may show on purpose. They are
// thrown by `issueWhatsAppChallenge` (db/whatsapp-auth.ts) and must survive
// the fix unchanged.
const DELIBERATE_REFUSALS = [
  "Enter a valid mobile number.",
  "WhatsApp is unavailable. Please try again later.",
  "Please wait before requesting another code.",
];

const issueWhatsAppChallenge = vi.fn();
const verifyPinResetCode = vi.fn();
const saveResetPin = vi.fn();

vi.mock("@/db/whatsapp-auth", () => ({
  issueWhatsAppChallenge: (...args: unknown[]) => issueWhatsAppChallenge(...args),
}));
vi.mock("@/db/whatsapp-auth-complete", () => ({
  verifyPinResetCode: (...args: unknown[]) => verifyPinResetCode(...args),
  saveResetPin: (...args: unknown[]) => saveResetPin(...args),
}));

import { handleWhatsAppAuth } from "@/lib/auth/whatsapp-route";

const APEX_HOST = "aqua.harness.test";
const OPS_HOST = "ops.harness.test";
const TOKEN = "a".repeat(64);

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://${APEX_HOST}/api/login/pin-recovery`, {
    method: "POST",
    headers: {
      host: APEX_HOST,
      origin: `https://${APEX_HOST}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const PIN = { intent: "save", pin: "654321", confirmPin: "654321" } as const;
const VERIFY = { intent: "verify", code: "123456" } as const;
const REQUEST = { intent: "request", phone: "9000000099" } as const;
const PIN_COOKIE = { cookie: `aqua_whatsapp_pin_reset=${TOKEN}` };

async function answer(input: unknown, headers: Record<string, string> = PIN_COOKIE) {
  const response = await handleWhatsAppAuth(post(input, headers), "pin_reset");
  const body = (await response.json()) as { step?: string; error?: string; notice?: string };
  return { status: response.status, body };
}

// An unexpected failure is uncertain: a 503 and one fixed sentence, the
// phase's own step, and nothing of the internal failure in the answer.
function expectUncertain(status: number, body: { step?: string; error?: string }, step: string) {
  expect(status).toBe(503);
  expect(body.error).toBe(UNCERTAIN_ANSWER);
  expect(body.step).toBe(step);
  expect(JSON.stringify(body)).not.toMatch(/try again/i);
  expect(JSON.stringify(body)).not.toContain(BLANKET_ANSWER);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the PIN-recovery route does not leak internal failures to an unauthenticated caller", () => {
  it("answers an unexpected save failure as uncertain, with one fixed sentence", async () => {
    saveResetPin.mockRejectedValueOnce(new Error(SENTINEL));

    const { status, body } = await answer(PIN);

    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    expectUncertain(status, body, "pin");
  });

  it("answers an unexpected verify failure as uncertain, with one fixed sentence", async () => {
    verifyPinResetCode.mockRejectedValueOnce(new Error(SENTINEL));

    const { status, body } = await answer(VERIFY);

    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    expectUncertain(status, body, "code");
  });

  it("answers an unexpected request failure as uncertain, with one fixed sentence", async () => {
    issueWhatsAppChallenge.mockRejectedValueOnce(new Error(SENTINEL));

    const { status, body } = await answer(REQUEST, {});

    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    expectUncertain(status, body, "phone");
  });

  it("answers a non-Error throw as uncertain too, and never with a blanket Try again", async () => {
    saveResetPin.mockRejectedValueOnce("AQUA_FAKE_STRING_THROW_4b2e");

    const { status, body } = await answer(PIN);

    expect(JSON.stringify(body)).not.toContain("AQUA_FAKE_STRING_THROW_4b2e");
    expect(body.error).not.toBe(BLANKET_ANSWER);
    expectUncertain(status, body, "pin");
  });
});

describe("the PIN-recovery route keeps the three deliberate refusals", () => {
  it("still answers an invalid mobile number with its own message", async () => {
    issueWhatsAppChallenge.mockRejectedValueOnce(new Error(DELIBERATE_REFUSALS[0]));

    const { status, body } = await answer(REQUEST, {});

    expect(status).toBe(200);
    expect(body.error).toBe(DELIBERATE_REFUSALS[0]);
    expect(body.step).toBe("phone");
    expect(body.error).not.toBe(UNCERTAIN_ANSWER);
  });

  it("still answers an unavailable provider with its own message", async () => {
    issueWhatsAppChallenge.mockRejectedValueOnce(new Error(DELIBERATE_REFUSALS[1]));

    const { status, body } = await answer(REQUEST, {});

    expect(status).toBe(200);
    expect(body.error).toBe(DELIBERATE_REFUSALS[1]);
    expect(body.step).toBe("phone");
    expect(body.error).not.toBe(UNCERTAIN_ANSWER);
  });

  it("still answers the one-minute throttle with its own message", async () => {
    issueWhatsAppChallenge.mockRejectedValueOnce(new Error(DELIBERATE_REFUSALS[2]));

    const { status, body } = await answer(REQUEST, {});

    expect(status).toBe(200);
    expect(body.error).toBe(DELIBERATE_REFUSALS[2]);
    expect(body.step).toBe("phone");
    expect(body.error).not.toBe(UNCERTAIN_ANSWER);
  });
});

describe("the PIN-recovery route keeps its refusals and its generic answer", () => {
  it("still refuses an origin that does not match the host", async () => {
    const response = await handleWhatsAppAuth(
      new Request(`https://${APEX_HOST}/api/login/pin-recovery`, {
        method: "POST",
        headers: {
          host: APEX_HOST,
          origin: "https://elsewhere.harness.test",
          "content-type": "application/json",
        },
        body: JSON.stringify(PIN),
      }),
      "pin_reset",
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Use the sign-in page for this account.");
    expect(saveResetPin).not.toHaveBeenCalled();
  });

  it("still refuses an unparseable origin", async () => {
    const response = await handleWhatsAppAuth(
      new Request(`https://${APEX_HOST}/api/login/pin-recovery`, {
        method: "POST",
        headers: {
          host: APEX_HOST,
          origin: "not-a-url",
          "content-type": "application/json",
        },
        body: JSON.stringify(PIN),
      }),
      "pin_reset",
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Invalid origin.");
    expect(saveResetPin).not.toHaveBeenCalled();
  });

  it("still refuses every Ops WhatsApp login path", async () => {
    const response = await handleWhatsAppAuth(
      post(REQUEST, {
        host: OPS_HOST,
        origin: `https://${OPS_HOST}`,
      }),
      "ops_login",
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/operator password and authenticator/i);
    expect(issueWhatsAppChallenge).not.toHaveBeenCalled();
  });

  it("still refuses a tenant recovery request aimed at the Ops host", async () => {
    const response = await handleWhatsAppAuth(
      post(REQUEST, {
        host: OPS_HOST,
        origin: `https://${OPS_HOST}`,
      }),
      "pin_reset",
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Use the sign-in page for this account.");
    expect(issueWhatsAppChallenge).not.toHaveBeenCalled();
  });

  it("still answers a code request with the same generic notice whatever the account is", async () => {
    issueWhatsAppChallenge.mockResolvedValueOnce(TOKEN);

    const { status, body } = await answer(REQUEST, {});

    expect(status).toBe(200);
    expect(body.step).toBe("code");
    expect(body.notice).toMatch(/if this number has an active account/i);
  });
});
