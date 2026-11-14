import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { and, eq, inArray, like, lt, sql } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import { baVerification } from "./schema/better-auth";

const PREFIX = "staff-pin-address:";
export const PIN_ADDRESS_LIMIT = 20;
export const PIN_ADDRESS_WINDOW_MS = 60_000;

// Proxy headers supplement account authority; they never establish identity.
// Deployments must overwrite these at trusted ingress. Missing/invalid metadata
// shares a bounded fallback bucket, rather than disabling the public limiter.
function addressFrom(headers: Headers): string {
  const value = headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!value || !isIP(value)) return "unknown";
  return isIP(value) === 6 ? new URL(`http://[${value}]`).hostname : value;
}

/** Persistent short-lived auth state in a namespace no auth plugin reads. */
export async function consumePinAddressBudget(headers: Headers, now = Date.now()): Promise<boolean> {
  const id = PREFIX + createHash("sha256").update(addressFrom(headers)).digest("hex");
  // Cleanup is a separate statement/transaction, before acquiring any budget
  // lock. It cannot invert another request's row/advisory-lock order.
  await withPlatform(async () => {
    await db.delete(baVerification).where(inArray(baVerification.id,
      db.select({id:baVerification.id}).from(baVerification).where(and(
        like(baVerification.identifier, `${PREFIX}%`), lt(baVerification.expiresAt, new Date(now)),
      )).limit(100),
    ));
  });
  return withPlatform(() => db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
    const [row] = await tx.select().from(baVerification).where(eq(baVerification.id, id)).for("update");
    const live = row && row.expiresAt.getTime() > now;
    const attempts = live ? Number(row.value) : 0;
    if (!Number.isInteger(attempts) || attempts < 0 || attempts >= PIN_ADDRESS_LIMIT) return false;
    const values = {identifier:id,value:String(attempts+1),expiresAt:live ? row.expiresAt : new Date(now+PIN_ADDRESS_WINDOW_MS),updatedAt:new Date(now)};
    await tx.insert(baVerification).values({id,...values}).onConflictDoUpdate({target:baVerification.id,set:values});
    return true;
  }));
}
