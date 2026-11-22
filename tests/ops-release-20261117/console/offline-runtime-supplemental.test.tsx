// Supplemental post-implementation coverage; not historical RED evidence.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { OfflineRuntime } from "@/app/(platform)/ops/tenants/[tenantId]/configuration/offline-runtime";
it.each([[false, false, "Disabled"], [false, true, "Disabled"], [true, false, "Disabled"], [true, true, "Enabled"]] as const)("reports both offline gates: deployment=%s tenant=%s", (deploymentEnabled, tenantEnabled, effective) => {
  const html = renderToStaticMarkup(<OfflineRuntime deploymentEnabled={deploymentEnabled} tenantEnabled={tenantEnabled} />);
  expect(html).toContain(`Offline attendance runtime: ${effective}`);
  expect(html).toContain(`Deployment flag: ${deploymentEnabled ? "On" : "Off"}`);
  expect(html).toContain(`tenant switch: ${tenantEnabled ? "On" : "Off"}`);
});
