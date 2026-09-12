import { formatTimeIST, todayInZone } from "@/lib/time/tz";
import { verifyParentLinkToken } from "@/lib/services/parent-link";
import { getParentViewData } from "@/lib/services/parent-view";
import { getBranding } from "@/lib/services/branding";
import { asTenantId } from "@/lib/ids";
import { currentMonthPeriod } from "@/lib/services/attendance-history";

// C-45 — parent page. ZERO client JavaScript, no analytics, no
// tracking, no service worker, ever (architecture § 11.3).
//
// Implemented as a Route Handler that returns a raw HTML document.
// The previous page.tsx shipped ~10 <script> tags because the App
// Router root layout forced the client runtime onto every route. A
// route handler returns whatever bytes it chooses, so this surface
// is genuinely script-free.
//
// Why not React (renderToString)? Next.js disallows react-dom/server
// in route handlers ("render or return the content directly as a
// Server Component instead for perf and security"). The page is
// pure static markup with inline styles, so hand-building the HTML
// string is both allowed and the most honest implementation of the
// C-45 "zero client JavaScript" requirement — no framework at all
// is loaded.
//
// Auth: a signed token in the URL. The verifier rejects anything
// forged, expired, or for a different scope. A rejected token
// renders a generic "link expired or invalid" page — never the
// difference between "no such person" and "wrong signature", which
// would leak existence to a probing caller.
//
// The page is intentionally static: no "share" button, no client-
// side PDF, no JS analytics. Per the Never clause in
// implementation-plan.md § C-45.

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Kolkata",
});

const DAY_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Kolkata",
});

function formatTimeRange(startsAt: Date, endsAt: Date): string {
  return `${formatTimeIST(startsAt)}–${formatTimeIST(endsAt)}`;
}

function initialsFor(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const letters = parts.map((w) => w[0]!.toUpperCase()).join("");
  return letters || "?";
}

const ACCENT_BG: Record<string, string> = {
  mango: "#FFEEDB",
  marine: "#0D3B36",
  indigo: "#E3E1FA",
  plum: "#F5E1EE",
  forest: "#DFEBE0",
  slate: "#DEE3E8",
};

const ACCENT_INK: Record<string, string> = {
  mango: "#B84E00",
  marine: "#FFFFFF",
  indigo: "#2D2A6E",
  plum: "#5C1F47",
  forest: "#1F4A2C",
  slate: "#28323F",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0D3B36">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
</head>
<body style="margin:0;background:#EDF0EC;">${body}</body>
</html>`;
}

function statusColor(status: string): { color: string; bg: string } {
  if (status === "present") return { color: "#2E9E5B", bg: "#E4F4EA" };
  if (status === "late") return { color: "#B8710A", bg: "#FDF0DC" };
  return { color: "#D8453C", bg: "#FCE9E7" };
}

function renderExpired(): string {
  const body = `<main style="max-width:480px;margin:0 auto;padding:32px 20px;font-family:system-ui,sans-serif;color:#0F1F1C;">
<h1 style="font-size:22px;font-weight:600;margin:0 0 12px;">This link is no longer valid.</h1>
<p style="font-size:14px;line-height:1.5;color:#3C534F;margin:0;">Magic links expire after seven days for safety. Ask the academy to send you a fresh link from the member&rsquo;s record.</p>
</main>`;
  return wrapDocument("Link expired", body);
}

function renderParentView(args: {
  fullName: string;
  memberCode: string;
  nextSession: {
    sessionDate: string;
    startsAt: Date;
    endsAt: Date;
    batchName: string;
    coachName: string | null;
  } | null;
  attendance: {
    pct: number | null;
    presentCount: number;
    totalCount: number;
    recent: Array<{
      sessionDate: string;
      batchName: string;
      status: string;
    }>;
  };
  displayName: string;
  clubInitials: string;
  accentBg: string;
  accentInk: string;
}): string {
  const fullName = esc(args.fullName);
  const memberCode = esc(args.memberCode);
  const displayName = esc(args.displayName);
  const clubInitials = esc(args.clubInitials);
  const accentBg = esc(args.accentBg);
  const accentInk = esc(args.accentInk);

  const nextSessionHtml = args.nextSession
    ? (() => {
        const ns = args.nextSession;
        const dateText = DATE_FMT.format(
          new Date(`${ns.sessionDate}T00:00:00`),
        );
        const timeRange = esc(formatTimeRange(ns.startsAt, ns.endsAt));
        const batchName = esc(ns.batchName);
        const coachPart = ns.coachName
          ? ` &middot; with ${esc(ns.coachName)}`
          : "";
        return `<p style="font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:22px;font-weight:600;margin:0;color:#FFFFFF;">${esc(dateText)}</p>
<p style="font-size:14px;margin:6px 0 0;color:rgba(255,255,255,.85);">${timeRange} &middot; ${batchName}${coachPart}</p>`;
      })()
    : `<p style="font-size:14px;margin:0;color:rgba(255,255,255,.85);">No upcoming sessions scheduled.</p>`;

  const attendanceHtml =
    args.attendance.totalCount === 0
      ? `<p style="font-size:14px;color:#3C534F;margin:0;">No sessions have been marked yet this month.</p>`
      : (() => {
          const pct = args.attendance.pct ?? 0;
          return `<div style="display:flex;align-items:baseline;gap:12px;">
<p style="font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:38px;font-weight:600;margin:0;color:#0D3B36;line-height:1;">${pct}%</p>
<p style="font-size:14px;margin:0;color:#3C534F;">${args.attendance.presentCount} of ${args.attendance.totalCount} sessions marked present</p>
</div>`;
        })();

  const recentListHtml =
    args.attendance.recent.length === 0
      ? ""
      : (() => {
          const items = args.attendance.recent
            .map((r) => {
              const dayText = esc(
                DAY_FMT.format(new Date(`${r.sessionDate}T00:00:00`)),
              );
              const batchName = esc(r.batchName);
              const status = esc(r.status);
              const sc = statusColor(r.status);
              return `<li style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(15,31,28,.06);font-size:13px;">
<span style="color:#0F1F1C;">${dayText} &middot; <span style="color:#7B918D;">${batchName}</span></span>
<span style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;padding:3px 8px;border-radius:999px;color:${sc.color};background-color:${sc.bg};">${status}</span>
</li>`;
            })
            .join("");
          return `<ul style="list-style:none;padding:0;margin:20px 0 0;border-top:1px solid rgba(15,31,28,.08);">${items}</ul>`;
        })();

  const body = `<main style="max-width:560px;margin:0 auto;padding:0 16px 56px;font-family:'Instrument Sans',system-ui,sans-serif;color:#0F1F1C;background-color:#EDF0EC;min-height:100vh;">
<header style="padding:32px 0 24px;display:flex;align-items:center;gap:16px;">
<svg viewBox="0 0 100 100" width="56" height="56" role="img" aria-label="${displayName} mark">
<rect x="0" y="0" width="100" height="100" rx="22" ry="22" fill="${accentBg}" />
<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-family="'Bricolage Grotesque',system-ui,sans-serif" font-weight="600" font-size="${clubInitials.length === 1 ? 50 : 36}" fill="${accentInk}">${clubInitials}</text>
</svg>
<div>
<p style="font-size:11px;font-weight:500;letter-spacing:.10em;text-transform:uppercase;color:#7B918D;margin:0;">Member view</p>
<h1 style="font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:24px;font-weight:600;margin:4px 0 0;color:#0D3B36;">${displayName}</h1>
</div>
</header>

<section style="background-color:#FFFFFF;border-radius:20px;padding:24px;margin-bottom:16px;border:1px solid rgba(15,31,28,.10);">
<p style="font-size:11px;font-weight:500;letter-spacing:.10em;text-transform:uppercase;color:#7B918D;margin:0 0 8px;">Member</p>
<p style="font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:26px;font-weight:600;margin:0;color:#0D3B36;">${fullName}</p>
<p style="font-size:13px;color:#3C534F;margin:6px 0 0;font-family:monospace;">${memberCode}</p>
</section>

<section style="background-color:#0D3B36;color:#FFFFFF;border-radius:20px;padding:24px;margin-bottom:16px;">
<p style="font-size:11px;font-weight:500;letter-spacing:.10em;text-transform:uppercase;color:rgba(255,255,255,.70);margin:0 0 8px;">Next session</p>
${nextSessionHtml}
</section>

<section style="background-color:#FFFFFF;border-radius:20px;padding:24px;margin-bottom:16px;border:1px solid rgba(15,31,28,.10);">
<p style="font-size:11px;font-weight:500;letter-spacing:.10em;text-transform:uppercase;color:#7B918D;margin:0 0 12px;">This month</p>
${attendanceHtml}
${recentListHtml}
</section>

<footer style="padding:16px 0 0;text-align:center;font-size:11px;color:#7B918D;">
This link is unique to ${fullName}. It expires in 7 days and carries no tracking. Contact ${displayName} directly if it stops working.
</footer>
</main>`;

  return wrapDocument(`${args.fullName} · ${args.displayName}`, body);
}

export const dynamic = "force-dynamic";

function pageHeaders(): HeadersInit {
  // No service worker, no analytics, no third-party. Cache-control
  // is no-store because the page contains personal data about a
  // specific child.
  //
  // J4 — keep the page out of search engine indexes. The URL embeds
  // a signed token whose 7-day TTL bounds its exposure; a search
  // engine caching the response would extend that exposure to
  // "everyone who can read the cache" — incompatible with the
  // "magic link expires" contract the operator promised the
  // guardian. X-Robots-Tag is the only noindex knob Next.js
  // Route Handlers expose; `<meta name="robots">` would also
  // work but is read by some crawlers only after parsing HTML,
  // not at HTTP-fetch time. Header is the canonical surface.
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    "Cache-Control": "no-store",
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  const claims = verifyParentLinkToken(token);
  if (!claims) {
    return new Response(renderExpired(), { status: 200, headers: pageHeaders() });
  }

  const tenantId = asTenantId(claims.tenantId);
  const today = todayInZone("Asia/Kolkata");
  const period = currentMonthPeriod(today);
  const [branding, data] = await Promise.all([
    getBranding({ tenantId }),
    getParentViewData({
      tenantId,
      personId: claims.personId,
      today,
      monthStart: period.from,
      monthEnd: period.to,
    }),
  ]);

  if (!data) {
    // Token was valid but the member is gone (deleted between issue
    // and click). Render the same generic expired page so we don't
    // leak "the signature is fine but the person doesn't exist" vs.
    // "the signature is bad" — a probing caller should learn
    // nothing either way.
    return new Response(renderExpired(), { status: 200, headers: pageHeaders() });
  }

  const accent = branding.accent;
  const accentBg = ACCENT_BG[accent] ?? ACCENT_BG.mango;
  const accentInk = ACCENT_INK[accent] ?? ACCENT_INK.mango;
  const displayName = branding.displayName ?? branding.fallbackDisplayName;
  const clubInitials = initialsFor(
    branding.shortName ?? branding.fallbackShortName,
  );

  return new Response(
    renderParentView({
      fullName: data.child.fullName,
      memberCode: data.child.memberCode,
      nextSession: data.nextSession
        ? {
            sessionDate: data.nextSession.sessionDate,
            startsAt: data.nextSession.startsAt,
            endsAt: data.nextSession.endsAt,
            batchName: data.nextSession.batchName,
            coachName: data.nextSession.coachName,
          }
        : null,
      attendance: {
        pct: data.attendance.pct,
        presentCount: data.attendance.presentCount,
        totalCount: data.attendance.totalCount,
        recent: data.attendance.recent,
      },
      displayName,
      clubInitials,
      accentBg,
      accentInk,
    }),
    { status: 200, headers: pageHeaders() },
  );
}

// HEAD shares the GET status for monitoring; the body is not needed
// and we deliberately do not render to keep the route cheap.
export async function HEAD(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  verifyParentLinkToken(token);
  return new Response(null, { status: 200, headers: pageHeaders() });
}
