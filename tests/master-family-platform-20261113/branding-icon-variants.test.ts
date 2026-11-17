import sharp from "sharp";
import { expect, it } from "vitest";
import { brandingIconVariant as variant } from "@/lib/branding/prepare-image";

it.each([192, 512] as const)("returns a real %s pixel PNG variant", async (size) => {
  const original = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#345678" } }).png().toBuffer();
  const result = await variant(original, size);
  expect(result).not.toBeNull();
  if (result) {
    const meta = await sharp(result).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", size, size]);
  }
});
it("rejects corrupt input and unsupported sizes", async () => {
  const original = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#345678" } }).png().toBuffer();
  expect(await variant(Buffer.from("invalid"), 192)).toBeNull();
  expect(await variant(original, 42 as 192)).toBeNull();
});
