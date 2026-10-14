import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/auth-db";
import { withPlatform } from "@/db/scope";
import { platformUsers, platformSessions, platformAuditLog } from "@/db/schema/platform-users";
import { normaliseToE164 } from "@/lib/phone";

// Explicit provisioning operation. No phone is assigned from a request-time
// login form or from an email/password fallback.
const email = z.string().email().parse(process.argv[2]);
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/).parse(normaliseToE164(process.argv[3] ?? ""));
await withPlatform(() => db.transaction(async (tx) => {
  const [user] = await tx.select().from(platformUsers).where(and(eq(platformUsers.email, email.toLowerCase()),
    eq(platformUsers.status, "active"))).for("update");
  if (!user) throw new Error("Active operator not found.");
  await tx.update(platformUsers).set({ phone, updatedAt: new Date() }).where(eq(platformUsers.id, user.id));
  await tx.delete(platformSessions).where(eq(platformSessions.userId, user.id));
  await tx.insert(platformAuditLog).values({ actorId: user.id, action: "platform.phone.provisioned",
    targetType: "platform_user", targetId: user.id, detail: { phoneLast4: phone.slice(-4) } });
}));
console.log("Operator WhatsApp number registered.");
process.exit(0);
