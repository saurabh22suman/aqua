import sharp from "sharp";
import { expect, it } from "vitest";
import * as branding from "@/lib/services/branding";

type Result = { ok: true; png: Uint8Array } | { ok: false };
type Prepare = (input: { bytes: Uint8Array; mime: string; kind: "logo" | "install_icon" }) => Promise<Result>;
// The fallback gives a behavior assertion, not an import/setup error, before
// the image processor exists; real invalid inputs must also fail closed.
const prepare: Prepare = (branding as unknown as { prepareBrandingImage?: Prepare }).prepareBrandingImage ?? (async () => ({ ok: false }));

it("accepts a bounded static PNG and produces a decodable PNG", async () => {
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#000000" } }).png().toBuffer();
  const result = await prepare({ bytes, mime: "image/png", kind: "logo" });
  expect(result.ok).toBe(true);
  if (result.ok) expect((await sharp(result.png).metadata()).format).toBe("png");
});
it("rejects SVG, mismatched signatures, oversized input and corrupt images", async () => {
  for (const input of [
    { mime: "image/svg+xml", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
    { mime: "image/png", bytes: Buffer.from("not an image") },
    { mime: "image/png", bytes: Buffer.alloc(5 * 1024 * 1024 + 1) },
  ]) expect((await prepare({ ...input, kind: "install_icon" })).ok).toBe(false);
});

it.each([[20, 40], [40, 20]])("pads %sx%s install icons to a square without stretching", async (width, height) => {
  const bytes = await sharp({ create: { width, height, channels: 4, background: "#000000" } }).png().toBuffer();
  const result = await prepare({ bytes, mime: "image/png", kind: "install_icon" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    const metadata = await sharp(result.png).metadata();
    expect([metadata.width, metadata.height]).toEqual([512, 512]);
    expect(metadata.hasAlpha).toBe(true);
    const { data, info } = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
    expect(data[(Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4 + 3]).toBe(255);
  }
});

it("applies EXIF orientation and removes input metadata", async () => {
  const bytes = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#000000" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await prepare({ bytes, mime: "image/jpeg", kind: "logo" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    const metadata = await sharp(result.png).metadata();
    expect([metadata.width, metadata.height]).toEqual([20, 40]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  }
});
