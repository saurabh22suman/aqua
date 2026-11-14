import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseEnv } from "@/lib/env";

// js-yaml is already installed as an ESLint dependency in the frozen lockfile.
// Resolve from ESLint rather than relying on pnpm exposing a transitive package.
const requireFromProject = createRequire(import.meta.url);
const requireFromEslint = createRequire(requireFromProject.resolve("eslint"));
const yaml = requireFromEslint("js-yaml") as { load: (source: string) => unknown };
const jobSchema = z.object({ env: z.record(z.string(), z.string()) });
const workflow = z.object({ jobs: z.object({ checks: jobSchema, "runtime-image": jobSchema }) })
  .parse(yaml.load(readFileSync(".github/workflows/ci.yml", "utf8")));

describe("CI job environments at production runtime", () => {
  it.each(["checks", "runtime-image"] as const)("parses the actual %s job environment", (job) => {
    const jobEnv = workflow.jobs[job]?.env;
    expect(jobEnv).toBeDefined();
    expect(() => parseEnv({ ...jobEnv, NODE_ENV: "production" })).not.toThrow();
  });

  it.each(["checks", "runtime-image"] as const)("still rejects a short parent secret for %s", (job) => {
    const jobEnv = workflow.jobs[job]?.env;
    expect(jobEnv).toBeDefined();
    expect(() => parseEnv({ ...jobEnv, NODE_ENV: "production", PARENT_LINK_SECRET: "too-short" })).toThrow(/PARENT_LINK_SECRET/);
  });
});
