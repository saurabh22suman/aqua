import { createHmac } from "node:crypto";

// RFC 6238 test code for a synthetic enrolled operator only.
export function currentTotp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const n = alphabet.indexOf(char);
    if (n < 0) throw new Error("invalid test TOTP secret");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
