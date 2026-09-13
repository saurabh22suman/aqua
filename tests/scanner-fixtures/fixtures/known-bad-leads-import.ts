// Known-bad fixture for scripts/check-platform-leads-imports.ts.
// Parsed, never executed. A tenant-surface file reaching directly for
// the platform_leads table is the import shape the scan must flag.

import { platformLeads } from "@/db/schema/platform-leads";

export const probe = platformLeads;
