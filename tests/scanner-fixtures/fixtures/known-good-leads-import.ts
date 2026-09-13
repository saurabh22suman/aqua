// Known-good sibling for the leads import fixture: the ops action
// importing the service is allowlisted. Parsed, never executed.

import { listLeads } from "@/db/platform-leads";

export const probe = listLeads;
