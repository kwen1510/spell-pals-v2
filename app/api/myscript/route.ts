import { NextRequest, NextResponse } from "next/server";
import {
  buildMyScriptPayload,
  computeMyScriptHmac,
  MYSCRIPT_ENDPOINT,
  parseMyScriptCandidates,
  type MyScriptJiix,
} from "../../../lib/handwriting/myscript-api";
import type { Stroke } from "../../../lib/handwriting/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_STROKES = 128;
const MAX_POINTS = 12_000;
const MAX_BODY_CHARACTERS = 2_000_000;
const MAX_COORDINATE_MAGNITUDE = 1_000_000_000;
const MAX_TIMESTAMP = 10_000_000_000_000;
const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 30;
const requests = new Map<string, { count: number; resetAt: number }>();

function credentials() {
  const applicationKey = process.env.MYSCRIPT_APPLICATION_KEY?.trim();
  const hmacKey = process.env.MYSCRIPT_HMAC_KEY?.trim();
  return applicationKey && hmacKey ? { applicationKey, hmacKey } : null;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const requestHost = forwardedHost || request.headers.get("host") || request.nextUrl.host;
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

function withinRateLimit(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = forwarded || request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  for (const [candidate, entry] of requests) {
    if (entry.resetAt <= now) requests.delete(candidate);
  }
  const existing = requests.get(key);
  if (!existing || existing.resetAt <= now) {
    requests.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  existing.count += 1;
  return existing.count <= REQUESTS_PER_WINDOW;
}

function isStroke(value: unknown): value is Stroke {
  if (!value || typeof value !== "object") return false;
  const stroke = value as Partial<Stroke>;
  return Array.isArray(stroke.points) && stroke.points.length > 0 && stroke.points.every((point) =>
    Boolean(point)
    && Number.isFinite(point.x)
    && Math.abs(point.x) <= MAX_COORDINATE_MAGNITUDE
    && Number.isFinite(point.y)
    && Math.abs(point.y) <= MAX_COORDINATE_MAGNITUDE
    && Number.isFinite(point.timestamp)
    && point.timestamp >= 0
    && point.timestamp <= MAX_TIMESTAMP
    && (point.pressure == null || (Number.isFinite(point.pressure) && point.pressure >= 0 && point.pressure <= 1))
  );
}

function validateStrokes(value: unknown): Stroke[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STROKES || !value.every(isStroke)) return null;
  const pointCount = value.reduce((sum, stroke) => sum + stroke.points.length, 0);
  return pointCount <= MAX_POINTS ? value : null;
}

export async function GET() {
  return json({ available: Boolean(credentials()) }, credentials() ? 200 : 503);
}

export async function POST(request: NextRequest) {
  const keys = credentials();
  if (!keys) return json({ message: "MyScript is not configured on this deployment." }, 503);
  if (!sameOrigin(request)) return json({ message: "This recognition request was not accepted." }, 403);
  if (!withinRateLimit(request)) return json({ message: "Too many recognition requests. Please wait a moment and try again." }, 429);

  let input: { strokes?: unknown; maxResults?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARACTERS) return json({ message: "The handwriting request was too large." }, 413);
    input = JSON.parse(raw) as { strokes?: unknown; maxResults?: unknown };
  } catch {
    return json({ message: "The handwriting request was not valid JSON." }, 400);
  }
  const strokes = validateStrokes(input.strokes);
  if (!strokes) return json({ message: "The handwriting request contained invalid or excessive stroke data." }, 400);
  const maxResults = typeof input.maxResults === "number" && Number.isFinite(input.maxResults)
    ? Math.max(1, Math.min(40, Math.floor(input.maxResults)))
    : 15;

  const payload = buildMyScriptPayload(strokes);
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 12_000);
  const cancelUpstream = () => controller.abort();
  request.signal.addEventListener("abort", cancelUpstream, { once: true });
  try {
    const upstream = await fetch(MYSCRIPT_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/vnd.myscript.jiix, application/json",
        "Content-Type": "application/json",
        applicationKey: keys.applicationKey,
        hmac: computeMyScriptHmac(body, keys.applicationKey, keys.hmacKey),
        "myscript-client-name": "spell-pals-v2",
        "myscript-client-version": "1.0.0",
      },
      body,
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const error = await upstream.json().catch(() => ({})) as { code?: string };
      if (error.code === "access.quota.exceeded" || error.code === "access.empty.cartridge") {
        return json({ message: "The MyScript test quota has been reached." }, 503);
      }
      if (error.code === "access.not.granted") return json({ message: "MyScript rejected the configured credentials." }, 502);
      return json({ message: "MyScript could not recognize this handwriting right now." }, 502);
    }
    const jiix = await upstream.json() as MyScriptJiix;
    return json({ candidates: parseMyScriptCandidates(jiix, maxResults) });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (!timedOut && request.signal.aborted) return new NextResponse(null, { status: 499, headers: { "Cache-Control": "no-store" } });
      return json({ message: "MyScript took too long to respond. Please try again." }, 504);
    }
    return json({ message: "Could not reach MyScript. Check the connection and try again." }, 502);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", cancelUpstream);
  }
}
