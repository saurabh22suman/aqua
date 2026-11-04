// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OwnerArtwork } from "@/components/owner-artwork/owner-artwork";
import { isServedBySurface } from "@/lib/surface-paths";
import { existsSync } from "node:fs";
import { join } from "node:path";

afterEach(() => { cleanup(); localStorage.clear(); });

it("serves each selected artwork on the apex for both Home and the chooser", () => {
  const identity = { tenantId: "tenant", userId: "user" };
  for (const motif of ["swimming", "badminton", "football", "tennis", "cricket", "yoga-fitness", "multi-sport"]) {
    for (const variant of ["tall", "phone", "wide"]) {
      const path = `/icons/owner-artwork/ks-owner-art-${motif}-${variant}-v1.svg`;
      expect(isServedBySurface(path, "apex")).toBe(true);
      expect(existsSync(join(process.cwd(), "public", path))).toBe(true);
    }
    localStorage.setItem("aqua:owner-art:tenant:user", motif);
    const view = render(<><OwnerArtwork identity={identity} /><OwnerArtwork identity={identity} mode="chooser" /></>);
    expect((screen.getByRole("radio", { name: motif === "yoga-fitness" ? "Yoga/Fitness" : motif === "multi-sport" ? "Multi-sport" : new RegExp(`^${motif}$`, "i") }) as HTMLInputElement).checked).toBe(true);
    for (const mask of view.container.querySelectorAll<HTMLElement>("[data-owner-artwork]")) {
      const path = mask.style.maskImage.match(/url\(["']?([^"')]+)/)?.[1];
      expect(path).toBeTruthy();
      expect(isServedBySurface(path!, "apex"), `${motif}: ${path}`).toBe(true);
      expect(isServedBySurface(path!, "ops")).toBe(false);
    }
    cleanup();
  }
});
