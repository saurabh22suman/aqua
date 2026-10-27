// B6 — a thin, typed wrapper around the `docker` CLI.
//
// The drill drives Docker directly (rather than through a container
// library) for two reasons: it needs to name exactly the containers
// it creates, and it needs to remove exactly those and nothing else.
// The drill's containers carry the postgres:16 image, which ships
// pg_dump and pg_restore — so the backup and restore tools are the
// SAME major version as the server, and no client tool has to be
// installed on the host.
//
// Nothing here logs. The caller decides what to print, and prints it
// through redactToolOutput().

import { spawnSync } from "node:child_process";

export type DockerTextResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type DockerBinaryResult = {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
};

const MAX_DUMP_BUFFER = 1024 * 1024 * 1024;

export class DockerError extends Error {
  readonly args: string[];
  readonly exitCode: number;
  readonly stderr: string;

  constructor(args: string[], exitCode: number, stderr: string) {
    super(`docker ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`);
    this.name = "DockerError";
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** Runs a docker command and returns its text output. */
export function runDocker(args: string[]): DockerTextResult {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: MAX_DUMP_BUFFER,
  });
  if (result.error) throw result.error;
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Runs a docker command and returns its stdout as raw bytes. pg_dump's
 * custom format is a BINARY stream: decoding it as text would corrupt
 * it, so the archive is captured as a Buffer and never stringified.
 */
export function runDockerBinary(
  args: string[],
  options: { input?: Buffer } = {},
): DockerBinaryResult {
  const result = spawnSync("docker", args, {
    encoding: "buffer",
    maxBuffer: MAX_DUMP_BUFFER,
    input: options.input,
  });
  if (result.error) throw result.error;
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
  };
}
