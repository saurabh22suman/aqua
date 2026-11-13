import { NextResponse } from "next/server";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { NotFoundError } from "@/lib/auth/context";
import {
  recordShowcaseDecision,
  showcaseDecisionInput,
} from "@/lib/services/showcase/decision";
import { readShowcaseState } from "@/lib/services/showcase/state";

export const dynamic = "force-dynamic";

function originAllowed(request: Request): boolean {
  const host = request.headers.get("host")?.toLowerCase();
  if (!host) return false;
  let origin: URL;
  try {
    origin = new URL(request.headers.get("origin") ?? "");
  } catch {
    return false;
  }
  return (
    origin.host.toLowerCase() === host &&
    (process.env.NODE_ENV !== "production" || origin.protocol === "https:")
  );
}

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

async function readBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const out: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function error(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ kind: "error", code, message }, { status });
}

export async function GET(): Promise<NextResponse> {
  const resolver = await resolveScopedSelfScope(null);
  if (!resolver) {
    return error("not_authenticated", "Sign in to see your showcase page.", 401);
  }
  try {
    const state = await resolver.read((tx, scope) => readShowcaseState(tx, scope));
    return NextResponse.json({ kind: "ok", state });
  } catch (cause) {
    if (cause instanceof NotFoundError) {
      return error("not_found", "That page is not available.", 404);
    }
    return error("internal", "Something went wrong. Try again.", 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request)) {
    return error("forbidden_origin", "This request did not come from this site.", 403);
  }

  const parsed = showcaseDecisionInput.safeParse(await readBody(request));
  if (!parsed.success) {
    return error(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "That request was not understood.",
      400,
    );
  }

  const resolver = await resolveScopedSelfScope(null);
  if (!resolver) {
    return error("not_authenticated", "Sign in to change your showcase page.", 401);
  }

  type ShowcaseOutcome =
    | { kind: "ok"; state: unknown; path: string }
    | { kind: "refused"; code: string; message: string; path: string }
    | { kind: "error"; code: string; message: string; status: number };

  const result: ShowcaseOutcome = await (async (): Promise<ShowcaseOutcome> => {
    try {
      return await resolver.read(async (tx, scope) => {
        const decision = await recordShowcaseDecision(tx, scope, parsed.data);
        const target =
          decision.ok ? decision.memberId : (parsed.data.memberId ?? null);
        const path =
          scope.audience === "member"
            ? "/member/showcase"
            : target
              ? `/family/showcase/${target}`
              : "/family";
        if (!decision.ok) {
          return {
            kind: "refused" as const,
            code: decision.code,
            message: decision.message,
            path,
          };
        }
        const state = await readShowcaseState(tx, scope);
        return { kind: "ok" as const, state, path };
      });
    } catch (cause) {
      if (cause instanceof NotFoundError) {
        return {
          kind: "error",
          code: "not_found",
          message: "That page is not available.",
          status: 404,
        };
      }
      return {
        kind: "error",
        code: "internal",
        message: "Something went wrong. Try again.",
        status: 500,
      };
    }
  })();

  if (result.kind === "error") {
    return error(result.code, result.message, result.status);
  }

  if (result.kind === "refused") {
    const status = result.code === "busy" ? 409 : 403;
    if (wantsJson(request)) {
      return error(result.code, result.message, status);
    }
    const back = new URL(result.path, request.headers.get("origin") ?? request.url);
    back.searchParams.set("refused", result.message);
    return NextResponse.redirect(back, 303);
  }

  if (wantsJson(request)) {
    return NextResponse.json({ kind: "ok", state: result.state });
  }
  return NextResponse.redirect(new URL(result.path, request.headers.get("origin") ?? request.url), 303);
}
