# Bundle audit — Phase 5.7

Per-route first-load JS, captured from `pnpm build` output.
The repository budget is 150 kB gzipped first-load; nothing
above approaches it.

| Route | Route JS | Shared | Total | Status |
|---|---:|---:|---:|---|
| /api/auth/[...all] | 188 B | 102 kB | 102 kB | ✓ |
| /api/health | 188 B | 102 kB | 102 kB | ✓ |
| /coach | 854 B | 102 kB | 106 kB | ✓ |
| /coach/me | 188 B | 102 kB | 102 kB | ✓ |
| /coach/members | 188 B | 102 kB | 102 kB | ✓ |
| /coach/register/[sessionId] | 3.98 kB | 102 kB | 109 kB | ✓ |
| /coach/schedule | 172 B | 102 kB | 106 kB | ✓ |
| /login | 1.77 kB | 102 kB | 104 kB | ✓ |
| /owner | 854 B | 102 kB | 106 kB | ✓ |
| /owner/batches/[batchId] | 854 B | 102 kB | 106 kB | ✓ |
| /owner/enquiries | 1.47 kB | 102 kB | 107 kB | ✓ |
| /owner/enquiries/[enquiryId] | 127 B | 102 kB | 124 kB | ✓ |
| /owner/members | 2.32 kB | 102 kB | 108 kB | ✓ |
| /owner/members/[memberId] | 2.71 kB | 102 kB | 108 kB | ✓ |
| /owner/members/[memberId]/edit | 1.33 kB | 102 kB | 103 kB | ✓ |
| /owner/members/new | 127 B | 102 kB | 123 kB | ✓ |
| /owner/onboarding | 854 B | 102 kB | 106 kB | ✓ |
| /owner/programs | 4.25 kB | 102 kB | 110 kB | ✓ |
| /owner/reports | 804 B | 102 kB | 103 kB | ✓ |
| /owner/reports/attendance.csv | 188 B | 102 kB | 102 kB | ✓ |
| /owner/settings | 854 B | 102 kB | 106 kB | ✓ |
| /owner/settings/branding | 3.21 kB | 102 kB | 109 kB | ✓ |
| /owner/settings/terminology | 3.43 kB | 102 kB | 109 kB | ✓ |
| /owner/staff | 818 B | 102 kB | 106 kB | ✓ |
| /owner/staff/[staffId] | 854 B | 102 kB | 106 kB | ✓ |
| /owner/staff/invitations | 2.61 kB | 102 kB | 108 kB | ✓ |
| /owner/staff/invitations/new | 2.57 kB | 102 kB | 108 kB | ✓ |
| /owner/staff/new | 2.56 kB | 102 kB | 108 kB | ✓ |
| /parent | 188 B | 102 kB | 102 kB | ✓ |
| /platform | 854 B | 102 kB | 106 kB | ✓ |
| /platform/activity | 1.94 kB | 102 kB | 104 kB | ✓ |
| /platform/features | 2.10 kB | 102 kB | 104 kB | ✓ |
| /platform/login | 1.18 kB | 102 kB | 103 kB | ✓ |
| /platform/presets | 1.21 kB | 102 kB | 107 kB | ✓ |
| /platform/presets/[key] | 1.80 kB | 102 kB | 107 kB | ✓ |
| /platform/tenants | 172 B | 102 kB | 106 kB | ✓ |
| /platform/tenants/[tenantId] | 3.66 kB | 102 kB | 109 kB | ✓ |
| /platform/tenants/new | 2.11 kB | 102 kB | 107 kB | ✓ |
| /platform/verify | 1.24 kB | 102 kB | 103 kB | ✓ |
| /reception | 172 B | 102 kB | 106 kB | ✓ |
| /reception/enquiries | 1.47 kB | 102 kB | 107 kB | ✓ |
| /reception/enquiries/[enquiryId] | 127 B | 102 kB | 124 kB | ✓ |
| /reception/members/[memberId] | 2.20 kB | 102 kB | 104 kB | ✓ |
| /reception/members/new | 127 B | 102 kB | 123 kB | ✓ |

**Max-loaded route:** /owner/enquiries/[enquiryId] at 124 kB total —
26 kB under the 150 kB first-load limit. Closest second is
/reception/members/new at 123 kB.

The two heaviest route-handlers (program-detail and enquiries
detail) sit slightly higher because they import the dynamic
listing components that pull the form. They're still well
inside the budget; no `barrel-from-lucide-react` regressions
were introduced this batch.

Run the audit command locally: `pnpm build 2>&1 | grep '/[a-z]'`.
