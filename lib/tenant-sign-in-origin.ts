import { isOpsHost } from "@/lib/ops-host";

// Ops and tenant sign-in have separate hosts. Only a configured tenant
// origin may receive an owner bearer link; never infer it from the browser.
export function tenantSignInOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    return null;
  }
  const host = url.hostname;
  const local = host === "localhost" || host.endsWith(".localhost") ||
    host === "127.0.0.1" || host === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (isOpsHost(url.host)) return null;
  return url.origin;
}
