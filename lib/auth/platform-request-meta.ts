import { headers } from "next/headers";
import { isIP } from "node:net";

/** Address limits supplement the account limit; proxy headers are never identity. */
export async function platformRequestMeta() {
  try {
    const h = await headers();
    const candidate = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return {
      ipAddress: candidate && isIP(candidate) ? candidate : undefined,
      userAgent: h.get("user-agent")?.slice(0, 256),
    };
  } catch {
    // Internal callers can have no HTTP context. The persistent account
    // limit still applies; absence never selects a global "unknown IP".
    return {};
  }
}
