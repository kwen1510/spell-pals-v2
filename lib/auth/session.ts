import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "spell_pals_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const TOKEN_VERSION = "v1";

export function passwordSecret(): string | null {
  return process.env.PASSWORD?.trim() || null;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function passwordMatches(candidate: string, secret: string): boolean {
  return safeEqual(candidate, secret);
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${expiresAt}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [version, rawExpiry, providedSignature, ...extra] = token.split(".");
  if (extra.length || version !== TOKEN_VERSION || !/^\d+$/.test(rawExpiry) || !providedSignature) return false;
  const expiresAt = Number(rawExpiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const payload = `${version}.${rawExpiry}`;
  return safeEqual(providedSignature, signature(payload, secret));
}

export function isRequestAuthenticated(request: NextRequest): boolean {
  const secret = passwordSecret();
  return Boolean(secret && verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value, secret));
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
