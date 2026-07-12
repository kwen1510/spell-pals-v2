import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const requestHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
      || request.headers.get("host")
      || request.nextUrl.host;
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ message: "This logout request was not accepted." }, { status: 403 });
  }
  const response = NextResponse.json({ authenticated: false }, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
