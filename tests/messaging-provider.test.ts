import { describe, expect, it } from "vitest";
import {
  getMessageProvider,
  MESSAGE_COST_PAISE,
  resolveProviderName,
} from "@/lib/messaging/provider";
import { parseEnv } from "@/lib/env";

// C-40a — provider selection and the production boot guard. The mock
// must be impossible in production at two layers: env parsing refuses
// to boot, and the resolver refuses to hand one out.

const PROD_ENV = {
  DATABASE_URL: "postgresql://app_login:test-pw@localhost:5432/aqua",
  APP_LOGIN_PASSWORD: "test-pw",
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "https://aqua.example.com",
  PARENT_LINK_SECRET: "parent-secret",
  NODE_ENV: "production",
};

describe("resolveProviderName", () => {
  it("defaults to the mock outside production", () => {
    expect(resolveProviderName({ provider: undefined, nodeEnv: "development" })).toBe("mock");
    expect(resolveProviderName({ provider: undefined, nodeEnv: "test" })).toBe("mock");
  });

  it("defaults to disabled in production", () => {
    expect(resolveProviderName({ provider: undefined, nodeEnv: "production" })).toBe("disabled");
  });

  it("honours an explicit provider", () => {
    expect(resolveProviderName({ provider: "cloud", nodeEnv: "production" })).toBe("cloud");
    expect(resolveProviderName({ provider: "disabled", nodeEnv: "development" })).toBe("disabled");
  });

  it("refuses the mock in production at the resolver layer too", () => {
    expect(() =>
      resolveProviderName({ provider: "mock", nodeEnv: "production" }),
    ).toThrow(/mock/i);
  });

  it("hands out no provider in production and a mock outside it", () => {
    expect(getMessageProvider({ provider: undefined, nodeEnv: "production" })).toBeNull();
    const mock = getMessageProvider({ provider: undefined, nodeEnv: "test" });
    expect(mock?.name).toBe("mock");
  });

  it("keeps the estimate table integer-paise and marketing dearer", () => {
    expect(MESSAGE_COST_PAISE.utility).toBe(12n);
    expect(MESSAGE_COST_PAISE.marketing).toBe(90n);
    expect(MESSAGE_COST_PAISE.marketing > MESSAGE_COST_PAISE.utility * 7n).toBe(true);
  });
});

describe("env boot guard for WHATSAPP_PROVIDER", () => {
  it("refuses to boot in production when the mock is selected", () => {
    expect(() =>
      parseEnv({ ...PROD_ENV, WHATSAPP_PROVIDER: "mock" }),
    ).toThrow(/WHATSAPP_PROVIDER=mock is not permitted in production/);
  });

  it("boots in production with the mock unset (resolver disables it)", () => {
    const parsed = parseEnv({ ...PROD_ENV });
    expect(parsed.WHATSAPP_PROVIDER).toBeUndefined();
    expect(resolveProviderName({ provider: parsed.WHATSAPP_PROVIDER, nodeEnv: "production" })).toBe(
      "disabled",
    );
  });
});
