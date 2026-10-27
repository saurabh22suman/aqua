# Develop consolidation — 27 October 2026

Base: origin/develop d692fd322ca8aa369e23ee0b6056130e57aee298.
Original worktrees preserved; integration uses a dedicated worktree and disposable database.

Included: inherited B5 login/recovery, menu accessibility and Owner insights;
B8 Lavender Owner home/shell/themes; B6 staff bookings/price administration,
attendance report scope, enquiry audit trail, local disposable restore drill;
B7 synthetic history; B9 suspended/churned tenant request-time access block and
passing role/availability regressions.

Independent review identified and agents corrected two defects before integration:
GST scaling now preserves synthetic partially paid invoices; failed container
readiness now cleans up the disposable restore container. The existing screen
contract tests exposed missing booking route/Menu helper documentation; the
inventory was completed without weakening the tests.

Not included: landing B10 remains under active character-art revision. The full
Ops audit stays in its original worktree: credential issuance lacks an audit
record (two intentional RED tests), and environment-password login lacks rate
limiting. Do not interpret this integration as clearance for release.

Other release limitations: enquiry conversion multi-transaction race; whole-site
versus lane booking overlap policy; actual R2 restore and application/worker
recovery proof; populated Owner chart visual approval; sales pricing/legal/demo
request endpoint. Owner character styling still needs comparison with newer art.

No production deployment, main promotion or demo seeding is part of this change.
No protected tier1 test or migration was edited. The new booking action permission
map entries are under lib/auth and require the repository's human review gate.

Verification results will be recorded after the integrated gates finish.
