// Ops redesign (28 October 2026) — a fresh one-time code for the
// independent review operator.
//
// The review signs in with the synthetic operator's password and then
// with an authenticator code. The code is single-use and time-limited,
// so the reviewer needs a fresh one.
//
// NOTHING SECRET IS PRINTED. The code is written to a mode-0600 file
// and only the PATH is printed.
//
//   python3 .opencode/scripts/lane_job.py exec bash -c \
//     'set -a; . ./.env.aqua-harness-test.local; set +a; \
//      pnpm exec tsx e2e/ops-redesign/ops-review-code.ts'
//
// The file holds the code for the OPERATOR in the fixture file
// (e2e/ops-redesign/ops-fixture.ts). It is the synthetic review
// operator — never a real credential.

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { currentTotpCode } from "@/db/platform-auth";
import { readFixture } from "./ops-fixture";

const OUT_FILE =
  process.env.AQUA_OPS_REVIEW_CODE_FILE ??
  "/home/soloengine/.local/state/aqua-harness/ops-redesign-20261028/review-code.txt";

async function main() {
  const fixture = readFixture();
  const code = currentTotpCode(fixture.operator.totpSecret);
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, `${code}\n`, { mode: 0o600 });
  chmodSync(OUT_FILE, 0o600);
  console.log("A fresh one-time code is ready.");
  console.log(`  file : ${OUT_FILE} (mode 0600)`);
  console.log(
    "  note : the code is single-use and expires in about 30 seconds — run this again when it does.",
  );
}

main().catch((error) => {
  console.error("The review code could not be produced.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
