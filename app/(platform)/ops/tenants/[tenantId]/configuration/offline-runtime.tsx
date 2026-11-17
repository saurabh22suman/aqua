export function OfflineRuntime({ deploymentEnabled, tenantEnabled }: { deploymentEnabled: boolean; tenantEnabled: boolean }) {
  return <p className="mb-3 text-[13px] text-ink-2">Offline attendance runtime: {deploymentEnabled && tenantEnabled ? "Enabled" : "Disabled"}. Deployment flag: {deploymentEnabled ? "On" : "Off"}; tenant switch: {tenantEnabled ? "On" : "Off"}. Both must be on; user permissions and identity are checked separately.</p>;
}
