// Mock-only gate access — credential fingerprinting.
//
// A gate credential is a PIN a member types or an RFID tag they tap.
// Neither is ever stored: this module turns one into a keyed digest and
// is the only place a raw secret exists.
//
// THE SECRET IS DEDICATED. The digest is derived from
// AQUA_GATE_SECRET, not from BETTER_AUTH_SECRET. Rotating the platform's
// auth secret is a routine operation; if the credential digests rode on
// it, every card a club has issued would stop verifying on the day it
// happened, with nothing but "unknown credential" at the door to
// explain it.
//
// TWO KEYS, ONE SLOT. AQUA_GATE_SECRET issues and verifies.
// AQUA_GATE_SECRET_PREVIOUS verifies only. A rotation is therefore: put
// the old key in the previous slot, put the new key in the current slot,
// let the fleet re-issue at its own pace, then drop the previous key on
// purpose. Nothing breaks in between, and nothing breaks silently.
//
// FAIL CLOSED. A missing or weak secret throws at the crypto boundary.
// It never falls back to a derived key: a silent fallback looks exactly
// like "every card is invalid", which is the failure mode this module
// exists to prevent.
//
// The HKDF label below is a WIRE FORMAT, not a brand string: it is part
// of the digest derivation, so changing it invalidates every issued
// credential. See docs/mock-access.md for the provisioning procedure.

import { createHmac, hkdfSync } from "node:crypto";

export type GateSecretKind = "pin" | "rfid";

export const GATE_SECRET_ENV = "AQUA_GATE_SECRET";
export const GATE_SECRET_PREVIOUS_ENV = "AQUA_GATE_SECRET_PREVIOUS";
export const MIN_GATE_SECRET_LENGTH = 32;

const HKDF_INFO_PREFIX = "aqua:gate:credential:v1";

const WHITESPACE = /\s/;

export class GateSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateSecretError";
  }
}

export type GateSecretRing = {
  current: string;
  previous: string | null;
};

// Strict validation of the key material.
//
// The value is the key material, VERBATIM. It is never trimmed and
// never normalised: silently changing the bytes would silently change
// every credential digest, and a fleet that stops verifying looks like
// lost data rather than a key change. So a value that would need
// normalising is REFUSED, loudly, and the operator fixes it on purpose.
//
// The rules, in the order they are checked:
//
//   * it must be present and not empty;
//   * it must be at least MIN_GATE_SECRET_LENGTH characters — counted
//     on the raw value, so padding cannot buy length;
//   * it must contain no whitespace anywhere — a padded value is a
//     copy-and-paste accident, and padding is length without material;
//   * it must not be one repeated character — length without entropy.
//
// The same rules apply to the previous key: a weak previous key would
// weaken every verification that falls back to it.
export function validateGateSecret(
  value: string,
  variableName: string,
): string {
  if (value.length === 0) {
    throw new GateSecretError(
      `${variableName} is not set — refusing to fingerprint a gate ` +
        `credential. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  if (value.length < MIN_GATE_SECRET_LENGTH) {
    throw new GateSecretError(
      `${variableName} is shorter than ${MIN_GATE_SECRET_LENGTH} characters — ` +
        `refusing to fingerprint a gate credential.`,
    );
  }
  if (WHITESPACE.test(value)) {
    throw new GateSecretError(
      `${variableName} contains whitespace — refusing to fingerprint a gate ` +
        `credential. The value is used exactly as written: set it without ` +
        `padding, because trimming it here would change every credential digest.`,
    );
  }
  if (new Set(value).size === 1) {
    throw new GateSecretError(
      `${variableName} is a single repeated character — refusing to ` +
        `fingerprint a gate credential. Generate a random value.`,
    );
  }
  return value;
}

// Read at call time, not at import time, so a rotation takes effect
// without a restart and so a test can exercise it. The variable is
// deliberately NOT in lib/env.ts: that file is shared, and the
// premises-QR secret is read the same way (lib/services/premises-qr.ts).
export function requireGateSecrets(): GateSecretRing {
  const current = process.env[GATE_SECRET_ENV];
  if (current === undefined) {
    throw new GateSecretError(
      `${GATE_SECRET_ENV} is not set — refusing to fingerprint a gate ` +
        `credential. Without a server-side key the digest would be an ` +
        `unsalted hash of a 6-digit PIN, which is reversible in seconds. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  validateGateSecret(current, GATE_SECRET_ENV);

  const previous = process.env[GATE_SECRET_PREVIOUS_ENV];
  if (previous === undefined || previous.length === 0) {
    return { current, previous: null };
  }
  validateGateSecret(previous, GATE_SECRET_PREVIOUS_ENV);

  return { current, previous };
}

// The device keypad sends digits; an RFID reader sends a tag id. Both
// may arrive with surrounding whitespace from the transport. Trim
// whitespace only — never strip leading zeros from a tag, and never
// reformat a PIN: the value presented is the value hashed.
export function normaliseGateSecret(raw: string): string {
  return raw.trim();
}

function subkey(
  material: string,
  tenantId: string,
  kind: GateSecretKind,
): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(material, "utf8"),
      Buffer.from(tenantId, "utf8"),
      `${HKDF_INFO_PREFIX}:${kind}`,
      32,
    ),
  );
}

function digestWith(
  material: string,
  tenantId: string,
  kind: GateSecretKind,
  secret: string,
): string {
  return createHmac("sha256", subkey(material, tenantId, kind))
    .update(secret, "utf8")
    .digest("hex");
}

// The CURRENT key's digest — what a newly issued credential stores, and
// what an access event records as the credential's fingerprint. (The
// event always uses the current key, so a rotation does not change what
// a replayed event is compared against.)
export function gateCredentialFingerprint(
  tenantId: string,
  kind: GateSecretKind,
  rawSecret: string,
): string {
  const { current } = requireGateSecrets();
  return digestWith(current, tenantId, kind, normaliseGateSecret(rawSecret));
}

// Every digest a presented secret could have: the current key's first,
// then the previous key's while a rotation is in flight. The order
// matters — a credential re-issued under the current key always wins.
export function gateCredentialFingerprintCandidates(
  tenantId: string,
  kind: GateSecretKind,
  rawSecret: string,
): string[] {
  const { previous } = requireGateSecrets();
  const secret = normaliseGateSecret(rawSecret);
  const candidates = [gateCredentialFingerprint(tenantId, kind, rawSecret)];
  if (previous) {
    candidates.push(digestWith(previous, tenantId, kind, secret));
  }
  return candidates;
}
