import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const gate = workflow.slice(workflow.indexOf("\n  ci:\n"));
const script = gate.split("        run: |\n")[1]?.split("\n").map((line) => line.replace(/^          /, "")).join("\n");
describe("required CI gate", () => {
  it("always depends on both independent lanes, without triggering publication on develop", () => {
    expect(gate).toContain("if: ${{ always() }}");
    expect(gate).toContain("needs: [checks, runtime-image]");
    expect(workflow).toContain("branches: [main, develop]");
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(readFileSync(".github/workflows/publish.yml", "utf8")).toContain("branches: [main]");
  });
  it("provisions the same complete disposable Postgres contract on both runners", () => {
    const lane = (name: string) => workflow.split(`\n  ${name}:\n`)[1].split("\n    steps:")[0];
    const services = (name: string) => lane(name).split("    services:\n")[1].split("\n    env:")[0];
    expect(services("runtime-image")).toBe(services("checks"));
    expect(services("runtime-image")).toContain("POSTGRES_USER: aqua");
    expect(services("runtime-image")).toContain("5432:5432");
    expect(services("runtime-image")).toContain("--health-retries 10");
  });
  // Execute the real gate body, rather than merely asserting YAML text.
  for (const checks of ["success", "failure", "cancelled", "skipped", ""]) {
    for (const runtime of ["success", "failure", "cancelled", "skipped", ""]) {
      it(`accepts only success/success: ${checks}/${runtime}`, () => {
        expect(script).toBeTruthy();
        const result = spawnSync("bash", ["-e", "-c", script!], {
          env: { ...process.env, CHECKS_RESULT: checks, RUNTIME_RESULT: runtime },
        });
        expect(result.status === 0).toBe(checks === "success" && runtime === "success");
      });
    }
  }
});
