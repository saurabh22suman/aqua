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
    // Session lifetime is per-role by design (architecture §6.1):
    // owner/coach/admin sit on personal phones and get the full
    // 30-day sliding window here. The receptionist cap (12h hard,
    // shared front-desk device) cannot live in this global config --
    // better-auth has no per-role session concept -- so it is
    // enforced in our own layer instead: sessionExists() returns
    // false and requireDefaultCtx()/requireCtx() throw once a
    // receptionist session passes isSessionExpiredForRole().
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
    },
    // 2026-09-11 auth feature (phone+PIN): the credential provider is
    // how a tenant user signs in with phone + PIN after accepting a
    // magic link. The identity is the same ba_user the phone-OTP
    // plugin creates; the credential slot (ba_account, provider
    // "credential") is written by lib/services/credentials.ts.
    //
    // disableSignUp is mandatory: enabling emailAndPassword registers
    // the public /sign-up/email endpoint, and without this flag anyone
    // who can reach it can mint a ba_user row. Nobody self-registers
    // in this product — every identity arrives via an invite.
    // requireEmailVerification stays off (the stored emails are
    // synthetic `${phone}@phone.aqua.local`; there is no mail channel).
    // minPasswordLength 6 admits the 6-12 digit PIN policy; the PIN
    // shape itself is enforced by Zod at the route boundary, and the
    // per-account lockout lives in the credentials service.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 6,
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
