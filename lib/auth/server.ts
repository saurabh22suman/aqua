import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@/db/auth-db";
import { betterAuthSchema } from "../../db/schema/better-auth";
import { linkBetterAuthUser } from "../../db/platform";
import { activateInvitedMemberships } from "../../db/membership-activation";
import { deliverOtp } from "./otp-delivery";

export function createAuth(authDb: NodePgDatabase<Record<string, never>>) {
  return betterAuth({
    database: drizzleAdapter(authDb, {
      provider: "pg",
      schema: betterAuthSchema,
    }),
    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
    },
    plugins: [
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        sendOTP: ({ phoneNumber, code }) => {
          deliverOtp(phoneNumber, code);
        },
        signUpOnVerification: {
          getTempEmail: (phoneNumber) => `${phoneNumber}@phone.aqua.local`,
        },
        callbackOnVerification: async ({ phoneNumber, user }) => {
          const userId = await linkBetterAuthUser(user.id, phoneNumber);
          await activateInvitedMemberships(userId);
        },
      }),
    ],
  });
}

export const auth = createAuth(db);
