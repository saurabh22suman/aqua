import { cookies } from "next/headers";

const COOKIE_NAME = "platform_session";

export function platformSessionCookieMaxAgeSeconds(): number {
  return 60 * 60 * 8;
}

export async function readPlatformSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

export async function writePlatformSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: platformSessionCookieMaxAgeSeconds(),
  });
}

export async function clearPlatformSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// Re-export for tests that need to assert cookie name presence in headers
export const PLATFORM_COOKIE_NAME = COOKIE_NAME;

