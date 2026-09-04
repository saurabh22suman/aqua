import { notFound } from "next/navigation";
import { todayInZone } from "@/lib/time/tz";
import { verifyParentLinkToken } from "@/lib/services/parent-link";
import { getParentViewData } from "@/lib/services/parent-view";
import { getBranding } from "@/lib/services/branding";
import { asTenantId } from "@/lib/ids";
import { currentMonthPeriod } from "@/lib/services/attendance-history";

// C-45 — parent page. ZERO client JavaScript, no analytics, no
// tracking, ever (architecture § 11.3). Server-rendered with the
// tenant's brand inlined as static HTML and CSS, so the page works
// with JavaScript disabled and ships no telemetry.
//
// Auth: a signed token in the URL. The verifier rejects anything
// forged, expired, or for a different scope. A rejected token
// renders a generic "link expired or invalid" page — never the
// difference between "no such person" and "wrong signature",
// which would leak existence to a probing caller.
//
// The route deliberately does NOT include any client interactivity:
// no "share" button, no client-side PDF, no JS analytics. Per the
// Never clause in implementation-plan.md § C-45.

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Kolkata",
});

const TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata",
});

const DAY_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Kolkata",
});

function formatTimeRange(startsAt: Date, endsAt: Date): string {
  return `${TIME_FMT.format(startsAt)}–${TIME_FMT.format(endsAt)}`;
}

function initialsFor(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
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

export const dynamic = "force-dynamic";

export default async function ParentLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claims = verifyParentLinkToken(token);
  if (!claims) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "32px 20px", fontFamily: "system-ui, sans-serif", color: "#0F1F1C" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>This link is no longer valid.</h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: "#3C534F" }}>
          Magic links expire after seven days for safety. Ask the academy
          to send you a fresh link from the member&apos;s record.
        </p>
      </main>
    );
  }

  const tenantId = asTenantId(claims.tenantId);
  const today = todayInZone("Asia/Kolkata");
  const period = currentMonthPeriod(today);
  const branding = await getBranding({ tenantId });
  const data = await getParentViewData({
    tenantId,
    personId: claims.personId,
    today,
    monthStart: period.from,
    monthEnd: period.to,
  });

  if (!data) {
    notFound();
  }

  const accent = branding.accent;
  const accentBg = ACCENT_BG[accent] ?? ACCENT_BG.mango;
  const accentInk = ACCENT_INK[accent] ?? ACCENT_INK.mango;
  const displayName = branding.displayName ?? branding.fallbackDisplayName;
  const clubInitials = initialsFor(branding.shortName ?? branding.fallbackShortName);

  return (
    <main
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "0 16px 56px",
        fontFamily: "Instrument Sans, system-ui, sans-serif",
        color: "#0F1F1C",
        backgroundColor: "#EDF0EC",
        minHeight: "100vh",
      }}
    >
      <header
        style={{
          padding: "32px 0 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <svg
          viewBox="0 0 100 100"
          width={56}
          height={56}
          role="img"
          aria-label={`${displayName} mark`}
        >
          <rect x="0" y="0" width="100" height="100" rx="22" ry="22" fill={accentBg} />
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="Bricolage Grotesque, system-ui, sans-serif"
            fontWeight={600}
            fontSize={clubInitials.length === 1 ? 50 : 36}
            fill={accentInk}
          >
            {clubInitials}
          </text>
        </svg>
        <div>
          <p
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: "#7B918D",
              margin: 0,
            }}
          >
            Member view
          </p>
          <h1
            style={{
              fontFamily: "Bricolage Grotesque, system-ui, sans-serif",
              fontSize: 24,
              fontWeight: 600,
              margin: "4px 0 0",
              color: "#0D3B36",
            }}
          >
            {displayName}
          </h1>
        </div>
      </header>

      <section
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 20,
          padding: 24,
          marginBottom: 16,
          border: "1px solid rgba(15, 31, 28, .10)",
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "#7B918D",
            margin: "0 0 8px",
          }}
        >
          Member
        </p>
        <p
          style={{
            fontFamily: "Bricolage Grotesque, system-ui, sans-serif",
            fontSize: 26,
            fontWeight: 600,
            margin: 0,
            color: "#0D3B36",
          }}
        >
          {data.child.fullName}
        </p>
        <p
          style={{
            fontSize: 13,
            color: "#3C534F",
            margin: "6px 0 0",
            fontFamily: "monospace",
          }}
        >
          {data.child.memberCode}
        </p>
      </section>

      <section
        style={{
          backgroundColor: "#0D3B36",
          color: "#FFFFFF",
          borderRadius: 20,
          padding: 24,
          marginBottom: 16,
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "rgba(255, 255, 255, .70)",
            margin: "0 0 8px",
          }}
        >
          Next session
        </p>
        {data.nextSession ? (
          <>
            <p
              style={{
                fontFamily: "Bricolage Grotesque, system-ui, sans-serif",
                fontSize: 22,
                fontWeight: 600,
                margin: 0,
                color: "#FFFFFF",
              }}
            >
              {DATE_FMT.format(new Date(`${data.nextSession.sessionDate}T00:00:00`))}
            </p>
            <p
              style={{
                fontSize: 14,
                margin: "6px 0 0",
                color: "rgba(255, 255, 255, .85)",
              }}
            >
              {formatTimeRange(data.nextSession.startsAt, data.nextSession.endsAt)} ·{" "}
              {data.nextSession.batchName}
              {data.nextSession.coachName
                ? ` · with ${data.nextSession.coachName}`
                : ""}
            </p>
          </>
        ) : (
          <p
            style={{
              fontSize: 14,
              margin: 0,
              color: "rgba(255, 255, 255, .85)",
            }}
          >
            No upcoming sessions scheduled.
          </p>
        )}
      </section>

      <section
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 20,
          padding: 24,
          marginBottom: 16,
          border: "1px solid rgba(15, 31, 28, .10)",
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "#7B918D",
            margin: "0 0 12px",
          }}
        >
          This month
        </p>
        {data.attendance.totalCount === 0 ? (
          <p style={{ fontSize: 14, color: "#3C534F", margin: 0 }}>
            No sessions have been marked yet this month.
          </p>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <p
              style={{
                fontFamily: "Bricolage Grotesque, system-ui, sans-serif",
                fontSize: 38,
                fontWeight: 600,
                margin: 0,
                color: "#0D3B36",
                lineHeight: 1,
              }}
            >
              {data.attendance.pct}%
            </p>
            <p
              style={{
                fontSize: 14,
                margin: 0,
                color: "#3C534F",
              }}
            >
              {data.attendance.presentCount} of {data.attendance.totalCount}{" "}
              sessions marked present
            </p>
          </div>
        )}
        {data.attendance.recent.length > 0 ? (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "20px 0 0",
              borderTop: "1px solid rgba(15, 31, 28, .08)",
            }}
          >
            {data.attendance.recent.map((r) => (
              <li
                key={`${r.sessionDate}-${r.batchName}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 0",
                  borderBottom: "1px solid rgba(15, 31, 28, .06)",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "#0F1F1C" }}>
                  {DAY_FMT.format(new Date(`${r.sessionDate}T00:00:00`))}
                  {" · "}
                  <span style={{ color: "#7B918D" }}>{r.batchName}</span>
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "3px 8px",
                    borderRadius: 999,
                    color:
                      r.status === "present"
                        ? "#2E9E5B"
                        : r.status === "late"
                          ? "#B8710A"
                          : "#D8453C",
                    backgroundColor:
                      r.status === "present"
                        ? "#E4F4EA"
                        : r.status === "late"
                          ? "#FDF0DC"
                          : "#FCE9E7",
                  }}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <footer
        style={{
          padding: "16px 0 0",
          textAlign: "center",
          fontSize: 11,
          color: "#7B918D",
        }}
      >
        This link is unique to {data.child.fullName}. It expires in 7 days
        and carries no tracking. Contact {displayName} directly if it
        stops working.
      </footer>
    </main>
  );
}
