import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("does not intercept or cache the private club logo, manifest and icon routes", () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const self = { location: { origin: "https://example.test" }, addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener) };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL, Response, Promise });
  const fetchHandler = listeners.get("fetch");
  expect(fetchHandler).toBeTypeOf("function");
  for (const path of [
    `/clubs/${"a".repeat(8)}/branding/logo/${"b".repeat(64)}?source=staff`,
    `/clubs/${"a".repeat(8)}/manifest.webmanifest?source=member`,
    `/clubs/${"a".repeat(8)}/icon/${"b".repeat(64)}/192?source=guardian`,
  ]) {
    const respondWith = vi.fn();
    fetchHandler!({ request: { url: `https://example.test${path}`, method: "GET", mode: "cors" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  }
});
