import { z } from "zod";

export type StoredAsset = { objectKey: string; sha256: string; contentType: "image/png" };
export function validAsset(raw: unknown, tenantId: string, kind: "logo" | "install_icon"): StoredAsset | null {
  const result = z.object({ objectKey: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), contentType: z.literal("image/png") }).strict().safeParse(raw);
  if (!result.success || result.data.objectKey !== `tenant-branding/${tenantId}/${kind}/${result.data.sha256}.png`) return null;
  return result.data;
}
