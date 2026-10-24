import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Every WhatsApp message this app sends has to land in ONE place: the
// configured mock. In a deployment that is the hosted mock at
// wa.preprabbit.in (WHATSAPP_CAPTURE_URL), reached through the
// capture transport.
//
// The bug this pins: the ops WhatsApp console sent through a bare
// in-process mock, which posts to WHATSAPP_MOCK_URL — the LOOPBACK
// viewer, validated as a loopback origin and therefore unset in a
// deployment. The action recorded "sent" and delivered nothing, so
// the mock stayed empty and the operator saw a success. A send path
// that builds its own transport instead of using the configured one
// is the same bug waiting to happen again.
//
// The three parts:
//   1. behaviour — with the capture provider configured, a send
//      really does POST the Cloud-API-shaped message to the capture
//      URL (the production one);
//   2. the env refuses a capture provider that has nowhere to send;
//   3. structure — no send path builds its own transport.

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib", "db", "worker", "components"];
// The two modules that DEFINE the transports. Everything else must
// use the configured provider.
const TRANSPORT_MODULES = ["lib/messaging/provider.ts", "lib/messaging/mock-provider.ts"];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("WhatsApp capture transport", () => {
  beforeEach(() => {
    vi.stubEnv("AQUA_NO_DOTENV", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("posts the message to the configured capture URL", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.mock.test" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    vi.stubEnv("WHATSAPP_PROVIDER", "capture");
    vi.stubEnv("AQUA_DEPLOYMENT_STAGE", "preview");
    vi.stubEnv("WHATSAPP_CAPTURE_URL", "https://wa.preprabbit.in");
    vi.stubEnv("WHATSAPP_CAPTURE_AUTH_HEADER", "authorization");
    vi.stubEnv("WHATSAPP_CAPTURE_AUTH_VALUE", "Bearer mock-secret");

    const { getMessageProvider } = await import("@/lib/messaging/provider");
    const provider = getMessageProvider();
    expect(provider).not.toBeNull();

    const result = await provider!.send({
      toPhone: "+919000000210",
      body: "Your child's session is at 18:00 today.",
      category: "utility",
    });
    expect(result.providerMessageId).toBe("wamid.mock.test");

    expect(calls).toHaveLength(1);
    // The Cloud API shape the mock speaks: /v23.0/<from>/messages, on
    // the CONFIGURED host.
    expect(calls[0]!.url).toBe("https://wa.preprabbit.in/v23.0/919000000000/messages");
    const payload = JSON.parse(String(calls[0]!.init?.body));
    expect(payload).toMatchObject({
      messaging_product: "whatsapp",
      to: "919000000210",
      type: "text",
    });
    expect(payload.text.body).toBe("Your child's session is at 18:00 today.");
    // The gateway credential, when one is configured, rides along.
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe(
      "Bearer mock-secret",
    );
  });

  it("refuses a capture provider that has nowhere to send", async () => {
    // WHATSAPP_PROVIDER=capture with no capture URL, or outside the
    // preview stage, is refused at boot: a capture provider with no
    // destination would silently swallow every message.
    vi.stubEnv("WHATSAPP_PROVIDER", "capture");
    vi.stubEnv("AQUA_DEPLOYMENT_STAGE", "preview");
    vi.stubEnv("WHATSAPP_CAPTURE_URL", "");
    await expect(import("@/lib/messaging/provider")).rejects.toThrow(
      /AQUA_DEPLOYMENT_STAGE=preview and WHATSAPP_CAPTURE_URL/,
    );

    vi.stubEnv("AQUA_DEPLOYMENT_STAGE", "production");
    vi.stubEnv("WHATSAPP_CAPTURE_URL", "https://wa.preprabbit.in");
    vi.resetModules();
    await expect(import("@/lib/messaging/provider")).rejects.toThrow(
      /AQUA_DEPLOYMENT_STAGE=preview and WHATSAPP_CAPTURE_URL/,
    );
  });

  it("lets only the transport modules build a transport", () => {
    // A send path that constructs its own provider is how the ops
    // console ended up delivering to a loopback URL that does not
    // exist in a deployment. The messaging modules are the only
    // place allowed to know what the transport is.
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(join(ROOT, dir))) {
        const relative = file.slice(ROOT.length + 1);
        if (TRANSPORT_MODULES.includes(relative)) continue;
        const text = readFileSync(file, "utf8");
        if (text.includes("createMockProvider(")) offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("sends through the configured provider, not an override", () => {
    // sendMessage takes an optional provider override. An override
    // that ignores WHATSAPP_CAPTURE_URL is the bug this file's
    // sibling test found; this pins that no call site passes one.
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(join(ROOT, dir))) {
        const relative = file.slice(ROOT.length + 1);
        const text = readFileSync(file, "utf8");
        for (const block of text.split("sendMessage({").slice(1)) {
          const call = block.split("})")[0] ?? "";
          if (/provider\s*:/.test(call)) offenders.push(relative);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
