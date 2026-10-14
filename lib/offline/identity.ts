import { z } from "zod";

export const offlineIdentitySchema = z.object({
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive(),
});
export type OfflineIdentity = z.infer<typeof offlineIdentitySchema>;
export const offlineSessionStateSchema = z.object({
  authenticated: z.boolean(), identity: offlineIdentitySchema.nullable(),
});
export const offlineCacheStateSchema = z.object({ identity: offlineIdentitySchema.optional(),
  blockedScope: z.string().regex(/^[a-f0-9]{64}$/).optional() });
