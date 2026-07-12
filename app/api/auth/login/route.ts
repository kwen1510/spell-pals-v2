import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  passwordMatches,
  passwordSecret,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "../../../../lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 15 * 60_000;
const ATTEMPTS_PER_WINDOW = 12;
const attempts = new Map<string, { count: number; resetAt: number }>();

function withinRateLimit(request: NextRequest): boolean {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
  const now = Date.now();
  for (const [candidate, entry] of attempts) if (entry.resetAt <= now) attempts.delete(candidate);
  const existing = attempts.get(key);
  if (!existing || existing.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  existing.count += 1;
  return existing.count <= ATTEMPTS_PER_WINDOW;
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const secret = passwordSecret();
  if (!secret) return json({ message: "Password login is not configured." }, 503);
  if (!withinRateLimit(request)) return json({ message: "Too many attempts. Please wait and try again." }, 429);

  let candidate: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2_000) return json({ message: "Unable to sign in." }, 400);
    candidate = (JSON.parse(raw) as { password?: unknown }).password;
  } catch {
    return json({ message: "Unable to sign in." }, 400);
  }
  if (typeof candidate !== "string" || !passwordMatches(candidate, secret)) {
    return json({ message: "The password is incorrect." }, 401);
  }

  const response = json({ authenticated: true }, 200);
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(secret), sessionCookieOptions);
  return response;
}
