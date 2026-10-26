// Screen-contract lane (docs/design-system/screens.md, flows.md,
// component-usage.md).
//
// This is a DOCS lane: there is no product code to TDD. The equivalent
// of a failing behavioural test is a STRUCTURAL contract that fails
// when the documentation and the application disagree. Four directions
// are checked:
//
//   1. docs -> app: every route named in the contracts must exist in
//      the app tree. A contract that invents a route is a contract
//      that sends a page task to build the wrong thing.
//   2. app -> docs: every page route inside the declared scope must be
//      inventoried. A route nobody documented is a route nobody owns.
//   3. vocabulary: every permission/feature key quoted in the
//      contracts must exist in the platform catalogue. A made-up
//      permission key is a silent authorization bug waiting to ship.
//   4. components: every component named in component-usage.md must
//      exist on disk, or be explicitly declared as planned work with
//      an owner. No silent references to components that do not exist.
//
// The scope prefixes and the non-screen exemptions are declared in the
// document itself (machine-readable HTML comment blocks), so the
// contract stays honest when another lane adds a route: a new route
// outside the declared scope is simply not this lane's screen, and a
// new route inside it must be documented before this test passes.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS = join(ROOT, "docs", "design-system");

const SCREENS_MD = join(DOCS, "screens.md");
const FLOWS_MD = join(DOCS, "flows.md");
const COMPONENT_USAGE_MD = join(DOCS, "component-usage.md");

const DOC_FILES = [SCREENS_MD, FLOWS_MD, COMPONENT_USAGE_MD];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readDoc(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * A missing document reads as empty rather than throwing at module load.
 * A crash during import is a setup error, not a failing test — the
 * contract must fail on assertions so the RED is a real observation.
 */
function docOrEmpty(path: string): string {
  return existsSync(path) ? readDoc(path) : "";
}

/** Every route the app actually serves, derived from the app/ tree. */
function appRoutes(kind: "page" | "handler"): string[] {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const isPage = entry === "page.tsx";
      const isHandler = entry === "route.ts";
      if (!isPage && !isHandler) continue;
      if ((kind === "page") !== isPage) continue;
      const rel = relative(join(ROOT, "app"), full);
      const segments = rel
        .split("/")
        .slice(0, -1)
        // Route groups are not part of the URL.
        .filter((s) => !(s.startsWith("(") && s.endsWith(")")));
      const route = "/" + segments.join("/");
      routes.push(route === "/" ? "/" : route.replace(/\/$/, ""));
    }
  };
  walk(join(ROOT, "app"));
  return [...new Set(routes)].sort();
}

/** Inline code spans in a markdown document. */
function codeSpans(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!.trim());
}

/** A quoted route: starts with "/" and uses only route-safe characters. */
function isRouteToken(token: string): boolean {
  return /^\/[A-Za-z0-9\-_.[\]/]*$/.test(token);
}

/** A quoted permission/feature key: dotted lowercase identifier. */
function isKeyToken(token: string): boolean {
  if (!/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/.test(token)) return false;
  // `plan.md`, `next.config.js` — filenames, not keys.
  return !/\.(md|ts|tsx|css|json|sql|png|jpg|svg|html|js|mjs|cjs|txt|yml|yaml)$/.test(
    token,
  );
}

/** Reads a machine-readable block from a document. */
function block(markdown: string, name: string): string[] {
  const match = markdown.match(
    new RegExp(`<!--\\s*screen-contract:${name}\\s*([\\s\\S]*?)-->`),
  );
  if (!match) return [];
  return match[1]!
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function readCatalogueKeys(): Set<string> {
  const source = readFileSync(join(ROOT, "db", "seed-platform.ts"), "utf8");
  const keys = new Set<string>();
  for (const match of source.matchAll(/key:\s*"([a-z][a-z0-9.]*)"/g)) {
    keys.add(match[1]!);
  }
  return keys;
}

// ---------------------------------------------------------------------------

describe("screen contract documents exist", () => {
  it("ships screens.md, flows.md and component-usage.md", () => {
    for (const path of DOC_FILES) {
      expect(existsSync(path), `${path} is missing`).toBe(true);
      expect(docOrEmpty(path).trim().length).toBeGreaterThan(2000);
    }
  });
});

describe("route inventory", () => {
  const screens = docOrEmpty(SCREENS_MD);
  const quotedRoutes = new Set(
    codeSpans(screens)
      .concat(codeSpans(docOrEmpty(FLOWS_MD)))
      .concat(codeSpans(docOrEmpty(COMPONENT_USAGE_MD)))
      .filter(isRouteToken),
  );

  it("names no route that the app does not serve", () => {
    const existing = new Set([...appRoutes("page"), ...appRoutes("handler")]);
    const invented = [...quotedRoutes].filter((route) => !existing.has(route));
    expect(
      invented,
      `These routes are named in the screen contract but do not exist in app/:\n${invented.join("\n")}`,
    ).toEqual([]);
  });

  it("inventories every page route inside the declared scope", () => {
    const scopePrefixes = block(screens, "scope-prefixes");
    expect(
      scopePrefixes.length,
      "screens.md must declare its scope prefixes in a screen-contract:scope-prefixes block",
    ).toBeGreaterThan(0);

    const notAScreen = block(screens, "not-a-screen");
    const pages = appRoutes("page");
    const missing = pages.filter((route) => {
      const inScope = scopePrefixes.some((prefix) =>
        prefix === "/"
          ? route === "/"
          : route === prefix || route.startsWith(`${prefix}/`),
      );
      if (!inScope) return false;
      if (notAScreen.some((fragment) => route.includes(fragment))) return false;
      return !quotedRoutes.has(route);
    });
    expect(
      missing,
      `These page routes are in scope but not documented in screens.md:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("covers every tenant and operator surface", () => {
    for (const surface of [
      "/owner",
      "/coach",
      "/reception",
      "/worker",
      "/parent",
      "/login",
      "/set-pin",
      "/check-in/[token]",
      "/ops",
    ]) {
      expect(quotedRoutes.has(surface), `${surface} is not documented`).toBe(true);
    }
    // The signed parent link is a route handler, not a page.
    expect(quotedRoutes.has("/p/[token]")).toBe(true);
  });

  it("keeps the ops console off the tenant surfaces", () => {
    // ops.localhost serves /ops/*; the tenant apex 404s it. The contract
    // must not describe an ops route inside a tenant screen section.
    const ownerSection = screens
      .split(/^## /m)
      .find((section) => section.startsWith("Owner"));
    expect(ownerSection).toBeDefined();
    const opsRoutesInOwner = codeSpans(ownerSection!).filter(
      (token) => isRouteToken(token) && token.startsWith("/ops"),
    );
    expect(
      opsRoutesInOwner,
      `These operator routes appear in the owner screen section:\n${opsRoutesInOwner.join("\n")}`,
    ).toEqual([]);
  });

  it("documents every destination the navigation actually offers", () => {
    // The nav is read as text rather than imported: lib/nav.ts pulls in
    // client components and next/navigation, which do not belong in a
    // node-environment test.
    const sources = [
      join(ROOT, "lib", "nav.ts"),
      join(ROOT, "app", "(platform)", "layout.tsx"),
    ];
    const hrefs = new Set<string>();
    for (const source of sources) {
      for (const match of readFileSync(source, "utf8").matchAll(
        /href:\s*"([^"]+)"/g,
      )) {
        hrefs.add(match[1]!);
      }
    }
    expect(hrefs.size).toBeGreaterThan(0);
    const undocumented = [...hrefs].filter((href) => !quotedRoutes.has(href));
    expect(
      undocumented,
      `These navigation destinations are not documented in screens.md:\n${undocumented.join("\n")}`,
    ).toEqual([]);
  });
});

describe("permission and feature vocabulary", () => {
  it("quotes only keys that exist in the platform catalogue", () => {
    const catalogue = readCatalogueKeys();
    const keys = new Set<string>();
    for (const path of DOC_FILES) {
      for (const token of codeSpans(docOrEmpty(path))) {
        if (isKeyToken(token)) keys.add(token);
      }
    }
    const invented = [...keys].filter((key) => !catalogue.has(key));
    expect(
      invented,
      `These permission/feature keys are quoted in the screen contract but are not in the platform catalogue:\n${invented.join("\n")}`,
    ).toEqual([]);
  });
});

describe("component inventory", () => {
  const usage = docOrEmpty(COMPONENT_USAGE_MD);

  it("names only components that exist or are declared foundation-delivered", () => {
    // The UI-foundation lane delivers primitives that are not in this
    // worktree until its integration. The component-usage contract
    // declares them explicitly, with an owner, so a component this lane
    // names is either on disk or owned by the foundation lane — never a
    // name invented here.
    const foundation = new Map(
      block(usage, "foundation-components").map((line) => {
        const [path, owner, note] = line.split("|").map((part) => part?.trim() ?? "");
        return [path, { owner, note }] as const;
      }),
    );
    const referenced = DOC_FILES.flatMap((path) =>
      codeSpans(docOrEmpty(path)).filter((token) => token.startsWith("components/")),
    );
    const unknown: string[] = [];
    for (const token of new Set(referenced)) {
      if (existsSync(resolve(ROOT, token))) continue;
      if (foundation.has(token)) continue;
      unknown.push(token);
    }
    expect(
      unknown,
      `These components are referenced but neither exist on disk nor appear in the foundation-components block:\n${unknown.join("\n")}`,
    ).toEqual([]);
  });

  it("gives every foundation-delivered component an owner and a note", () => {
    const foundation = block(usage, "foundation-components");
    expect(foundation.length).toBeGreaterThan(0);
    for (const line of foundation) {
      const parts = line.split("|").map((part) => part?.trim() ?? "");
      expect(parts.length, `Malformed foundation component: ${line}`).toBe(3);
      expect(parts[0], `Foundation component without a path: ${line}`).toMatch(
        /^components\//,
      );
      expect(parts[1], `Foundation component without an owner: ${line}`).not.toBe("");
      expect(parts[2], `Foundation component without a note: ${line}`).not.toBe("");
    }
  });

  it("documents every shared primitive under components/ui", () => {
    const uiDir = join(ROOT, "components", "ui");
    const primitives = readdirSync(uiDir)
      .filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))
      .map((file) => `components/ui/${file}`);
    const undocumented = primitives.filter(
      (path) => !codeSpans(usage).includes(path),
    );
    expect(
      undocumented,
      `These shared primitives are not documented in component-usage.md:\n${undocumented.join("\n")}`,
    ).toEqual([]);
  });
});

describe("task coverage the assignment requires", () => {
  const screens = docOrEmpty(SCREENS_MD);
  const flows = docOrEmpty(FLOWS_MD);

  it("states the mobile-first and desktop verification viewports", () => {
    for (const viewport of ["390×844", "1280×900", "1024×768", "1280×600"]) {
      expect(screens, `viewport ${viewport} is not named`).toContain(viewport);
    }
  });

  it("maps all eight reference screens to an Aqua decision", () => {
    for (const reference of [
      "Intro/splash",
      "Welcome",
      "Login",
      "Onboarding",
      "Home",
      "Profile",
      "Settings",
      "Subscription",
    ]) {
      expect(screens, `reference screen ${reference} is not mapped`).toContain(
        reference,
      );
    }
  });

  it("documents flows with entry, result and recovery for every surface", () => {
    for (const surface of [
      "Owner",
      "Coach",
      "Reception",
      "Worker",
      "Parent",
      "Ops",
      "Auth",
    ]) {
      expect(flows, `no ${surface} flow section`).toContain(surface);
    }
    expect(flows).toMatch(/recover/i);
    expect(flows).toMatch(/keyboard/i);
    expect(flows).toMatch(/offline/i);
  });

  it("records the next non-overlapping page implementation tasks", () => {
    expect(screens).toMatch(/next implementation task/i);
  });
});
