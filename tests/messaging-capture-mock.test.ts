import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockProvider } from "@/lib/messaging/mock-provider";
import { parseEnv } from "@/lib/env";
import { asTenantId } from "@/lib/ids";

const message = {
  tenantId: asTenantId("00000000-0000-4000-8000-000000000001"),
  toPhone: "+919000000004",
  body: "Aqua synthetic demo message",
  category: "utility" as const,
};

afterEach(() => vi.unstubAllGlobals());

describe("local WhatsApp capture mock", () => {
  it("passes an operator-configured hosted capture authentication header without following redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "hosted-synthetic" }] })));
    vi.stubGlobal("fetch", fetchMock);
    await createMockProvider({ url: "https://capture.example.test", headers: { authorization: "Bearer synthetic-test" } }).send(message);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer synthetic-test" });
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
  it("sends the body to the capture API and returns its message id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      messages: [{ id: "wamid.mock.capture" }],
    })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createMockProvider({
      url: "http://localhost:3000",
      fromPhone: "+919000000000",
    }).send(message);
    expect(result).toEqual({ providerMessageId: "wamid.mock.capture", status: "sent" });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/v23.0/919000000000/messages");
    expect(JSON.parse(options.body)).toEqual({
      messaging_product: "whatsapp", to: "919000000004",
      type: "text", text: { body: message.body },
    });
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not pretend success when the capture service rejects a send", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(createMockProvider({ url: "http://localhost:3000" }).send(message))
      .rejects.toThrow("HTTP 503");
  });

  it("rejects malformed success responses instead of generating a fake id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"messages":[]}')));
    await expect(createMockProvider({ url: "http://localhost:3000" }).send(message))
      .rejects.toThrow();
  });

  it("propagates transport failures without falling back to in-process success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection refused")));
    await expect(createMockProvider({ url: "http://localhost:3000" }).send(message))
      .rejects.toThrow("Connection refused");
  });

  it("accepts loopback capture origins and refuses remote destinations", () => {
    const base = { DATABASE_URL: "postgresql://app_login:test@localhost/aqua", NODE_ENV: "test" };
    expect(parseEnv({ ...base, WHATSAPP_MOCK_URL: "http://localhost:3000" }).WHATSAPP_MOCK_URL)
      .toBe("http://localhost:3000");
    for (const url of ["https://graph.facebook.com", "http://example.com", "http://localhost:3000/path", "invalid"]) {
      expect(() => parseEnv({ ...base, WHATSAPP_MOCK_URL: url })).toThrow();
    }
  });
});
