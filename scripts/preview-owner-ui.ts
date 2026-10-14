import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Avatar from "boring-avatars";
import {
  ArrowLeft,
  Ban,
  Briefcase,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Clock,
  Copy,
  Download,
  FileDown,
  FileText,
  Info,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Megaphone,
  Phone,
  Plus,
  QrCode,
  Receipt,
  RotateCcw,
  Search,
  Settings,
  TriangleAlert,
  Upload,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

// Prompt 3 — owner UI design preview.
//
// A tiny static server for docs/design/owner-ui-preview. It renders the
// preview-only dynamic bits so the HTML stays static and reviewable:
//   • /fontsource/*  — the repo's installed @fontsource files (the same
//                      latin-400/500/600 weights the app loads).
//   • /avatar.svg    — the real boring-avatars renderer the app uses,
//                      seeded by person/member id (never a name).
//   • /icon.svg      — individual lucide icons, the same set the app's
//                      nav registry uses.
//
// It reads no database, writes nothing, and is not part of the Next
// application. Run it with `pnpm preview:owner-ui`.

const PREVIEW_ROOT = resolve(process.cwd(), "docs/design/owner-ui-preview");
const FONTSOURCE_ROOT = resolve(process.cwd(), "node_modules/@fontsource");
const PORT = Number(process.env.PREVIEW_PORT ?? 3210);
const HOST = process.env.PREVIEW_HOST ?? "127.0.0.1";

// Individual icon references (not a package-barrel import in the app;
// this Node-only script has no bundle, and the names below are exactly
// the set the preview HTML uses).
const ICONS: Record<string, LucideIcon> = {
  "arrow-left": ArrowLeft,
  ban: Ban,
  briefcase: Briefcase,
  "calendar-days": CalendarDays,
  "calendar-range": CalendarRange,
  check: Check,
  "chevron-right": ChevronRight,
  "circle-check": CircleCheck,
  "clipboard-list": ClipboardList,
  clock: Clock,
  copy: Copy,
  download: Download,
  "file-down": FileDown,
  "file-text": FileText,
  info: Info,
  "layout-dashboard": LayoutDashboard,
  "list-checks": ListChecks,
  "map-pin": MapPin,
  megaphone: Megaphone,
  phone: Phone,
  plus: Plus,
  "qr-code": QrCode,
  receipt: Receipt,
  "rotate-ccw": RotateCcw,
  search: Search,
  settings: Settings,
  "triangle-alert": TriangleAlert,
  upload: Upload,
  "user-cog": UserCog,
  "user-plus": UserPlus,
  users: Users,
  wallet: Wallet,
  x: X,
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

async function sendFile(res: ServerResponse, path: string) {
  try {
    const body = await readFile(path);
    send(res, 200, CONTENT_TYPES[extname(path)] ?? "application/octet-stream", body);
  } catch {
    send(res, 404, "text/plain; charset=utf-8", `Not found: ${path}`);
  }
}

// Clean URLs map to the static files so links read like the product
// routes (/home, /members, /fees) without touching any app route.
const PAGE_ROUTES: Record<string, string> = {
  "/": "index.html",
  "/index": "index.html",
  "/home": "home.html",
  "/members": "members.html",
  "/member": "member.html",
  "/member-new": "member-new.html",
  "/member-edit": "member-edit.html",
  "/fees": "fees.html",
};

const colors = ["#0f766e", "#14b8a6", "#f59e0b", "#64748b", "#a7f3d0"];

function avatarSvg(params: URLSearchParams): string {
  const seed = params.get("seed") ?? "preview";
  const size = Math.min(96, Math.max(16, Number(params.get("size") ?? 40) || 40));
  const variant = params.get("variant") ?? "marble";
  const allowed = new Set(["marble", "beam", "pixel", "sunset", "ring", "bauhaus"]);
  const picked = (allowed.has(variant) ? variant : "marble") as
    | "marble"
    | "beam"
    | "pixel"
    | "sunset"
    | "ring"
    | "bauhaus";
  return renderToStaticMarkup(
    React.createElement(Avatar, { name: seed, size, variant: picked, colors }),
  );
}

function iconSvg(params: URLSearchParams): string | null {
  const name = params.get("name") ?? "";
  const Icon = ICONS[name];
  if (!Icon) return null;
  const size = Math.min(48, Math.max(12, Number(params.get("size") ?? 18) || 18));
  const color = params.get("color") ?? "#5B6F6B";
  const strokeWidth = Number(params.get("stroke") ?? 2) || 2;
  return renderToStaticMarkup(
    React.createElement(Icon, { size, color, strokeWidth, "aria-hidden": true }),
  );
}

const server = createServer((req, res) => {
  void (async () => {
    if (!req.url || !req.method || req.method !== "GET") {
      send(res, 405, "text/plain; charset=utf-8", "GET only");
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/avatar.svg") {
      send(res, 200, "image/svg+xml", avatarSvg(url.searchParams));
      return;
    }
    if (pathname === "/icon.svg") {
      const svg = iconSvg(url.searchParams);
      if (!svg) {
        send(res, 404, "text/plain; charset=utf-8", "Unknown icon");
        return;
      }
      send(res, 200, "image/svg+xml", svg);
      return;
    }
    if (pathname.startsWith("/fontsource/")) {
      const rel = normalize(pathname.slice("/fontsource/".length));
      const target = join(FONTSOURCE_ROOT, rel);
      if (!target.startsWith(FONTSOURCE_ROOT)) {
        send(res, 403, "text/plain; charset=utf-8", "Forbidden");
        return;
      }
      await sendFile(res, target);
      return;
    }

    const page = PAGE_ROUTES[pathname];
    const relative = page ?? pathname.replace(/^\//, "");
    const target = resolve(PREVIEW_ROOT, relative);
    if (!target.startsWith(PREVIEW_ROOT)) {
      send(res, 403, "text/plain; charset=utf-8", "Forbidden");
      return;
    }
    await sendFile(res, target);
  })().catch(() => send(res, 500, "text/plain; charset=utf-8", "Preview server error"));
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log("Aqua owner UI preview (static, no database, no writes)");
  console.log(`  Entry:    ${base}/`);
  console.log(`  Home:     ${base}/home`);
  console.log(`  Members:  ${base}/members`);
  console.log(`  Member:   ${base}/member`);
  console.log(`  Add:      ${base}/member-new`);
  console.log(`  Edit:     ${base}/member-edit`);
  console.log(`  Fees:     ${base}/fees`);
  console.log(`  Views:    desktop 1280×900 · mobile 390×844 · ?state=empty|loading|failed|limited|validation|confirm`);
});
