// CLI entry only. Privileged synthetic fixtures live in the test boundary;
// this entry and the fixture are never imported by web or worker code.
import { runOfflinePrivacy } from "../tests/db/offline-privacy-driver";
runOfflinePrivacy().catch(error => { console.error(error); process.exitCode = 1; });
