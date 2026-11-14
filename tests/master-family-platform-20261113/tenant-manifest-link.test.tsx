import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import * as links from "@/components/pwa/manifest-link";

const tenantId = "0190c000-0000-7000-8000-000000000001";
it("suppresses the global manifest on the explicit tenant install page", () => {
  expect(renderToStaticMarkup(<links.ManifestLink pathname={`/clubs/${tenantId}/install`} />)).toBe("");
});
it("emits one credentialed tenant manifest without putting the source in the identity", () => {
  const html = renderToStaticMarkup(<links.TenantManifestLink tenantId={tenantId} source="guardian" />);
  expect(html).toContain(`/clubs/${tenantId}/manifest.webmanifest?source=guardian`);
  expect(html).toMatch(/crossorigin="use-credentials"/i);
  expect((html.match(/rel="manifest"/g) ?? []).length).toBe(1);
});
it("keeps global manifest on normal pages and no metadata on Ops or parent links", () => {
  expect(renderToStaticMarkup(<links.ManifestLink pathname="/coach" />)).toContain('/manifest.webmanifest');
  expect(renderToStaticMarkup(<links.ManifestLink pathname="/ops" />)).toBe("");
  expect(renderToStaticMarkup(<links.ManifestLink pathname="/p/token" />)).toBe("");
});
