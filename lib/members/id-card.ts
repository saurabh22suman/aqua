import qrcode from "qrcode";

// §5.2 — Member identity card payload.
//
// Format: aqua://m/<tenantSlug>/<memberUuid>
//
// The payload is a URI with a fixed scheme (aqua://m/), the tenant's
// slug as a public disambiguator, and the member's UUID as the
// unguessable identifier. Nothing here is a secret — the defences
// against a forged or stolen card live at the scanner endpoint
// (V-21, not in this task): authentication, tenant-scope check,
// session-window guard, enrolment-set check, rate limit.
//
// Pinning the format here, with a test, is the whole point. Cards
// already printed at the demo and any future card issued must keep
// decoding once V-21 ships. A payload-shape change means re-issuing
// every physical card — pinned test fails if anyone drifts the
// scheme, host, or segment order.
const PAYLOAD_SCHEME = "aqua://m/" as const;

// Tenant slugs are enforced at the schema layer to [a-z0-9-]+ via
// tenants.slug (db/schema/tenants.ts). The regex below matches that
// constraint — the format pin rejects anything else so a typo in the
// caller fails loud at unit-test time, not at print.
const SLUG_REGEX = /^[a-z0-9-]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildMemberIdPayload(tenantSlug: string, memberUuid: string): string {
  if (!SLUG_REGEX.test(tenantSlug)) {
    throw new Error(
      `buildMemberIdPayload: tenantSlug "${tenantSlug}" is not a valid slug (must match ${SLUG_REGEX})`,
    );
  }
  if (!UUID_REGEX.test(memberUuid)) {
    throw new Error(
      `buildMemberIdPayload: memberUuid "${memberUuid}" is not a valid UUID (must match ${UUID_REGEX})`,
    );
  }
  return `${PAYLOAD_SCHEME}${tenantSlug}/${memberUuid}`;
}

// Reverse of buildMemberIdPayload. Returns null when the payload
// shape is wrong so a future caller (V-21 scanner) can distinguish
// "not one of our cards" from "one of our cards" without throwing
// on a stray menu QR.
export type ParsedMemberIdPayload = {
  tenantSlug: string;
  memberUuid: string;
};

export function parseMemberIdPayload(payload: string): ParsedMemberIdPayload | null {
  if (!payload.startsWith(PAYLOAD_SCHEME)) return null;
  const rest = payload.slice(PAYLOAD_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const tenantSlug = rest.slice(0, slash);
  const memberUuid = rest.slice(slash + 1);
  if (!SLUG_REGEX.test(tenantSlug)) return null;
  if (!UUID_REGEX.test(memberUuid)) return null;
  return { tenantSlug, memberUuid };
}

// Server-side QR rendering as inline SVG. The string is plain SVG
// markup (no scripts, no event handlers — qrcode's `svg` type is a
// `<svg>...</svg>` block). Caller injects via dangerouslySetInnerHTML
// on a wrapper, or inlines into a raw HTML string for the parent
// page if we ever extend that. No client JS for the QR.
export async function renderMemberIdQrSvg(payload: string): Promise<string> {
  return qrcode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });
}
