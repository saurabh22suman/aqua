// CLI entry only. The privileged synthetic fixture driver lives under
// scripts/lib because this entry is typechecked inside the runtime image
// build, which excludes the tests/ boundary; neither file is imported by
// web or worker code.
import { runOfflinePrivacy } from "./lib/offline-privacy-driver";
runOfflinePrivacy().catch(error => { console.error(error); process.exitCode = 1; });
