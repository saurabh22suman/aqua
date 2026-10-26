import { describe, expect, it, vi } from "vitest";
import { beforeEach } from "vitest";

// UI foundation — a successful PIN login must not inherit another
// account's display preferences.
//
// The measured leak (docs/handoffs/integration-fixes.md §5.1): the owner
// chose Lavender, then a different person signed in on the same device
// without signing out — the cookie survived and the second account
// rendered in the first account's palette.
//
// The PIN login route is the door where a new session is established, so
// the preferences that belong to the *previous* session are dropped
// there. A FAILED login must change nothing: a mistyped PIN must not
// strip the signed-in user's own preferences.
//
// The route is a Route Handler that relays better-auth's Set-Cookie
// headers, so it can carry the deletions on the same response.

const { pinLogin } = vi.hoisted(() => ({
  pinLogin: vi.fn(),
}));

vi.mock("@/lib/services/credentials", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/credentials")>();
  return {
    ...actual,
    pinLogin: (...args: unknown[]) => pinLogin(...(args as [])),
  };
});

import { POST } from "@/app/api/login/pin/route";
import { THEME_COOKIE } from "@/lib/theme/storage";
import { FACILITY_COOKIE } from "@/lib/facility";

function loginRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/login/pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setCookieHeaders(response: Response): string {
  return response.headers.getSetCookie().join("\n");
}

describe("PIN login and account-scoped display preferences", () => {
  beforeEach(() => {
    pinLogin.mockReset();
  });

  it("clears the previous theme and facility selection on a successful login", async () => {
    pinLogin.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "set-cookie": "better-auth.session_token=session-value; Path=/; HttpOnly",
        },
      }),
    );

    const response = await POST(loginRequest({ phone: "9000000202", pin: "482913" }));
    const cookies = setCookieHeaders(response);

    expect(response.status).toBe(200);
    // The preference cookies are deleted…
    expect(cookies).toContain(`${THEME_COOKIE}=`);
    expect(cookies).toContain(`${FACILITY_COOKIE}=`);
    // …by expiring them: either Max-Age=0 or an Expires date in the past.
    expect(
      /Max-Age=0/i.test(cookies) || /Expires=Thu, 01 Jan 1970/i.test(cookies),
    ).toBe(true);
    // …and the session cookie better-auth issued is still relayed.
    expect(cookies).toContain("better-auth.session_token=session-value");
  });

  it("preserves the preferences when the login fails", async () => {
    pinLogin.mockResolvedValue(new Response("{}", { status: 401 }));

    const response = await POST(loginRequest({ phone: "9000000201", pin: "000000" }));
    const cookies = setCookieHeaders(response);

    expect(response.status).toBe(401);
    // Nothing was deleted: a failed attempt must not strip the
    // signed-in user's own choices.
    expect(cookies).not.toContain(`${THEME_COOKIE}=`);
    expect(cookies).not.toContain(`${FACILITY_COOKIE}=`);
  });

  it("preserves the preferences when the request body is invalid", async () => {
    const response = await POST(loginRequest({ pin: "482913" }));
    const cookies = setCookieHeaders(response);

    expect(response.status).toBe(400);
    expect(cookies).not.toContain(`${THEME_COOKIE}=`);
    expect(cookies).not.toContain(`${FACILITY_COOKIE}=`);
    expect(pinLogin).not.toHaveBeenCalled();
  });
});
