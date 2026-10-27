import { describe, expect, it } from "vitest";
import {
  assertArchiveIsRestorable,
  assertDumpBytesLookValid,
  interpretArchiveListing,
  redactToolOutput,
} from "@/scripts/lib/disposable-restore/archive";

// B6 — deciding whether a dump is actually restorable.
//
// The existing backup library checks the five-byte "PGDMP" header.
// That proves the bytes are shaped like a custom-format archive; it
// does NOT prove the archive can be read. A dump truncated at 90% has
// the same header as a good one, and it is exactly the case where an
// operator believes they have a backup and do not.
//
// So the drill asks the tool that will actually do the restore:
// `pg_restore --list` parses the archive and prints its table of
// contents. A readable archive lists its entries; a truncated one
// fails with "end of file". These are pure decision functions over
// that tool's result, so they are unit-tested without Docker.

const GOOD_LISTING = `;
; Archive created at 2026-10-26 19:34:25 UTC
;     dbname: aqua_drill
;     TOC Entries: 6
;     Compression: gzip
;     Dump Version: 1.15-0
;     Format: CUSTOM
;     Integer: 4 bytes
;     Offset: 8 bytes
;
;
; Selected TOC Entries:
;
215; 1259 16385 TABLE public t aqua
3409; 0 16385 TABLE DATA public t aqua
`;

describe("assertDumpBytesLookValid", () => {
  it("accepts bytes that carry the custom-format header", () => {
    expect(() =>
      assertDumpBytesLookValid(new TextEncoder().encode("PGDMP....rest")),
    ).not.toThrow();
  });

  it("rejects an empty dump", () => {
    expect(() => assertDumpBytesLookValid(new Uint8Array(0))).toThrow(/empty/i);
  });

  it("rejects bytes that are not a custom-format dump", () => {
    expect(() =>
      assertDumpBytesLookValid(new TextEncoder().encode("not a dump")),
    ).toThrow(/PGDMP/);
  });
});

describe("interpretArchiveListing", () => {
  it("accepts a listing that names the custom format and lists entries", () => {
    const verdict = interpretArchiveListing({
      exitCode: 0,
      stdout: GOOD_LISTING,
      stderr: "",
    });
    expect(verdict.restorable).toBe(true);
    expect(verdict.reason).toBe("");
  });

  it("rejects an archive pg_restore could not read", () => {
    const verdict = interpretArchiveListing({
      exitCode: 1,
      stdout: "",
      stderr: "pg_restore: error: could not read from input file: end of file",
    });
    expect(verdict.restorable).toBe(false);
    expect(verdict.reason).toMatch(/end of file/i);
  });

  it("rejects a listing with no table of contents", () => {
    // Exit 0 with nothing listed means the archive holds no schema —
    // restoring it would produce an empty database that still "worked".
    const verdict = interpretArchiveListing({
      exitCode: 0,
      stdout: "; nothing to list\n",
      stderr: "",
    });
    expect(verdict.restorable).toBe(false);
    expect(verdict.reason).toMatch(/no entries|empty/i);
  });

  it("rejects an archive that is not in custom format", () => {
    const verdict = interpretArchiveListing({
      exitCode: 0,
      stdout: GOOD_LISTING.replace("Format: CUSTOM", "Format: PLAIN"),
      stderr: "",
    });
    expect(verdict.restorable).toBe(false);
    expect(verdict.reason).toMatch(/custom/i);
  });

  it("never puts a credential in the reason it reports", () => {
    const verdict = interpretArchiveListing({
      exitCode: 1,
      stdout: "",
      stderr:
        "pg_restore: error: connection to server failed: postgresql://aqua:hunter2@db.internal:5432/aqua",
    });
    expect(verdict.restorable).toBe(false);
    expect(verdict.reason).not.toContain("hunter2");
  });
});

describe("assertArchiveIsRestorable", () => {
  it("passes for a readable archive", () => {
    expect(() =>
      assertArchiveIsRestorable({ exitCode: 0, stdout: GOOD_LISTING, stderr: "" }),
    ).not.toThrow();
  });

  it("throws with the tool's reason for an unreadable archive", () => {
    expect(() =>
      assertArchiveIsRestorable({
        exitCode: 1,
        stdout: "",
        stderr: "pg_restore: error: could not read from input file: end of file",
      }),
    ).toThrow(/end of file/i);
  });

  it("throws for an empty archive", () => {
    expect(() =>
      assertArchiveIsRestorable({ exitCode: 0, stdout: "", stderr: "" }),
    ).toThrow();
  });
});

describe("redactToolOutput", () => {
  it("removes the password from a connection string", () => {
    const redacted = redactToolOutput(
      "failed: postgresql://aqua:hunter2@127.0.0.1:40001/aqua_drill",
    );
    expect(redacted).not.toContain("hunter2");
  });

  it("removes a password= assignment", () => {
    const redacted = redactToolOutput("PGPASSWORD=hunter2 pg_dump failed");
    expect(redacted).not.toContain("hunter2");
  });

  it("leaves ordinary tool output untouched", () => {
    const message = "pg_restore: error: could not read from input file: end of file";
    expect(redactToolOutput(message)).toContain("end of file");
  });
});
