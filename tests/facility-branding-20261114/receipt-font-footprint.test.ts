import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import manifest from "@/assets/receipt-fonts/manifest.json";

it("keeps the four Hindi and Kannada receipt faces within their compatible 181 KB budget", () => {
  const selected = [...manifest.fonts, ...manifest.bold_fonts.fonts].filter(({ family }) => family === "NotoSansDevanagari" || family === "NotoSansKannada");
  expect(selected).toHaveLength(4);
  const bytes = selected.reduce((total, { file }) => total + statSync(join(process.cwd(), "assets/receipt-fonts", file)).size, 0);
  expect(bytes).toBeLessThanOrEqual(181_000);
});

it("ships every declared server receipt face and license with its pinned digest", () => {
  for (const face of [...manifest.fonts, ...manifest.bold_fonts.fonts]) {
    const bytes = readFileSync(join(process.cwd(), "assets/receipt-fonts", face.file));
    expect(bytes.byteLength, face.file).toBe(face.bytes);
    expect(createHash("sha256").update(bytes).digest("hex"), face.file).toBe(face.sha256);
    const license = readFileSync(join(process.cwd(), "assets/receipt-fonts", face.license));
    expect(license.toString("utf8")).toMatch(/SIL OPEN FONT LICENSE/);
    const licenseDigest = "license_sha256" in face ? face.license_sha256 : manifest.bold_fonts.license_sha256;
    expect(createHash("sha256").update(license).digest("hex"), face.license).toBe(licenseDigest);
  }
});
