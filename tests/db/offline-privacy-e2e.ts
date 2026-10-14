// CLI entry for `pnpm e2e:offline-privacy`. It lives in the test
// boundary with its driver: the runtime image build excludes tests/ and
// typechecks scripts/, so a scripts/ entry importing this driver breaks
// the Docker build; the tier1 no-superuser scanner also sanctions
// tests/db/ as the home for privileged Testcontainer fixtures. Neither
// file is imported by web, worker or any scripts/ module.
import { runOfflinePrivacy } from "./offline-privacy-driver";
runOfflinePrivacy().catch(error => { console.error(error); process.exitCode = 1; });
