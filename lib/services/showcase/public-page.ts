import { TOKENS } from "@/lib/design-tokens";
import type { PublicShowcaseView } from "@/lib/services/showcase/public-view";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderShowcasePage(view: PublicShowcaseView): string {
  const chosenName = esc(view.chosenName);
  const clubName = esc(view.clubName);

  const achievements = view.achievements.length
    ? view.achievements
        .map((item) => {
          const label = esc(item.label);
          const level = esc(item.level);
          return `<li style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(15,31,28,.08);">
<span style="font-size:14px;color:${TOKENS.ink};">${label}</span>
<span style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:${TOKENS.water};">${level}</span>
</li>`;
        })
        .join("")
    : `<p style="font-size:13px;color:${TOKENS.ink2};margin:0;">No achievements have been recorded yet.</p>`;

  const body = `<main style="max-width:560px;margin:0 auto;padding:0 16px 56px;font-family:'Instrument Sans',system-ui,sans-serif;color:${TOKENS.ink};background-color:${TOKENS.deck};min-height:100vh;">
<header style="padding:32px 0 24px;">
<p style="font-size:11px;font-weight:500;letter-spacing:.10em;text-transform:uppercase;color:${TOKENS.ink3};margin:0;">${clubName}</p>
<h1 style="font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:26px;font-weight:600;margin:4px 0 0;color:${TOKENS.marine};">${chosenName}</h1>
</header>

<section style="background-color:${TOKENS.paper};border-radius:20px;padding:24px;margin-bottom:16px;border:1px solid rgba(15,31,28,.10);">
<p style="font-size:11px;font-weight:500;letter-spacing:.10em;text-transform:uppercase;color:${TOKENS.ink3};margin:0 0 4px;">Achievements</p>
<ul style="list-style:none;margin:0;padding:0;">
${achievements}
</ul>
</section>

<footer style="padding:16px 0 0;text-align:center;font-size:11px;color:${TOKENS.ink3};">
This page shows only what the member chose to share, recorded by ${clubName}'s coaches.
</footer>
</main>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0D3B36">
<meta name="referrer" content="no-referrer">
<title>${chosenName} · ${clubName}</title>
</head>
<body style="margin:0;background:${TOKENS.deck};">${body}</body>
</html>`;
}

export function renderShowcaseNotFound(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Not found</title>
</head>
<body style="margin:0;background:${TOKENS.deck};">
<main style="max-width:480px;margin:0 auto;padding:32px 20px;font-family:'Instrument Sans',system-ui,sans-serif;color:${TOKENS.ink};">
<h1 style="font-size:22px;font-weight:600;margin:0 0 12px;">This page is not available.</h1>
<p style="font-size:14px;line-height:1.5;color:${TOKENS.ink2};margin:0;">The link may have expired, or the page may not be shared.</p>
</main>
</body>
</html>`;
}
