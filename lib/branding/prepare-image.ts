import sharp from "sharp";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const FORMATS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

/** Decode only bounded, static raster input; return freshly encoded PNG. */
export async function prepareBrandingImage(input: {
  bytes: Uint8Array;
  mime: string;
  kind: "logo" | "install_icon";
}): Promise<{ ok: true; png: Uint8Array } | { ok: false }> {
  const expected = FORMATS[input.mime];
  if (!expected || input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_BYTES) return { ok: false };
  try {
    const image = sharp(input.bytes, { failOn: "warning", limitInputPixels: MAX_PIXELS, animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== expected || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) return { ok: false };
    const size = input.kind === "install_icon" ? 512 : 1024;
    const png = await image.rotate().resize(size, size, input.kind === "install_icon"
      ? { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }
      : { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    if (png.byteLength > MAX_BYTES) return { ok: false };
    return { ok: true, png };
  } catch {
    return { ok: false };
  }
}

/** Derive only the advertised icon sizes from a bounded canonical PNG. */
export async function brandingIconVariant(bytes: Uint8Array, size: 192 | 512): Promise<Uint8Array | null> {
  if ((size !== 192 && size !== 512) || !bytes.byteLength || bytes.byteLength > MAX_BYTES) return null;
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 512 * 512, animated: false });
    const meta = await image.metadata();
    if (meta.format !== "png" || meta.width !== 512 || meta.height !== 512 || (meta.pages ?? 1) !== 1) return null;
    return await image.resize(size, size).png().toBuffer();
  } catch {
    return null;
  }
}
