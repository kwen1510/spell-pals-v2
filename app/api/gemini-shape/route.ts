import { NextRequest, NextResponse } from "next/server";
import { getCharacterTemplate } from "../../../lib/handwriting/character-template";
import { assessShapeWithGemini, GEMINI_SHAPE_MODEL, type GeminiFeedbackLanguage } from "../../../lib/handwriting/gemini-shape-experiment";
import type { Stroke } from "../../../lib/handwriting/types";
import { isRequestAuthenticated } from "../../../lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_STROKES = 128;
const MAX_POINTS = 12_000;
const MAX_BODY_CHARACTERS = 2_000_000;
const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 30;
const requests = new Map<string, { count: number; resetAt: number }>();

function apiKey() {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

function experimentEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.GEMINI_SHAPE_EXPERIMENT_ENABLED === "true";
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
    const requestHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
      || request.headers.get("host")
      || request.nextUrl.host;
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

function withinRateLimit(request: NextRequest) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
  const now = Date.now();
  for (const [candidate, entry] of requests) if (entry.resetAt <= now) requests.delete(candidate);
  const existing = requests.get(key);
  if (!existing || existing.resetAt <= now) {
    requests.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  existing.count += 1;
  return existing.count <= REQUESTS_PER_WINDOW;
}

function validStroke(value: unknown): value is Stroke {
  if (!value || typeof value !== "object") return false;
  const stroke = value as Partial<Stroke>;
  return Array.isArray(stroke.points)
    && stroke.points.length > 0
    && stroke.points.every((point) => point
      && Number.isFinite(point.x)
      && Number.isFinite(point.y)
      && Number.isFinite(point.timestamp));
}

function validatedStrokes(value: unknown): Stroke[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_STROKES || !value.every(validStroke)) return null;
  return value.reduce((sum, stroke) => sum + stroke.points.length, 0) <= MAX_POINTS ? value : null;
}

export async function GET(request: NextRequest) {
  if (!isRequestAuthenticated(request)) return json({ message: "Authentication required." }, 401);
  const available = Boolean(apiKey()) && experimentEnabled();
  return json({ available, model: GEMINI_SHAPE_MODEL, experimental: true }, available ? 200 : 503);
}

export async function POST(request: NextRequest) {
  if (!isRequestAuthenticated(request)) return json({ message: "Authentication required." }, 401);
  const key = apiKey();
  if (!experimentEnabled()) return json({ message: "Handwriting checking is unavailable." }, 404);
  if (!key) return json({ message: "GEMINI_API_KEY is not configured." }, 503);
  if (!sameOrigin(request)) return json({ message: "This assessment request was not accepted." }, 403);
  if (!withinRateLimit(request)) return json({ message: "Too many handwriting checks. Please wait a moment." }, 429);

  let input: { expected?: unknown; strokes?: unknown; feedbackLanguage?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARACTERS) return json({ message: "The assessment request was too large." }, 413);
    input = JSON.parse(raw) as typeof input;
  } catch {
    return json({ message: "The assessment request was not valid JSON." }, 400);
  }
  if (typeof input.expected !== "string" || Array.from(input.expected).length !== 1) {
    return json({ message: "Provide one expected Chinese character." }, 400);
  }
  const template = getCharacterTemplate(input.expected);
  if (!template) return json({ message: "This experiment does not yet have grounded component data for that character." }, 422);
  const strokes = validatedStrokes(input.strokes);
  if (!strokes) return json({ message: "The request contained invalid or excessive stroke data." }, 400);
  const feedbackLanguage: GeminiFeedbackLanguage = input.feedbackLanguage === "zh-Hans" ? "zh-Hans" : "en-GB";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const assessment = await assessShapeWithGemini({
      apiKey: key,
      template,
      studentPaths: strokes.map((stroke) => stroke.points.map((point) => ({ x: point.x, y: point.y }))),
      feedbackLanguage,
      signal: controller.signal,
    });
    return json({ assessment, model: GEMINI_SHAPE_MODEL, experimental: true });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return json({ message: "Handwriting checking took too long. Please try again." }, 504);
    }
    const message = error instanceof Error && /api key|permission|quota|billing/i.test(error.message)
      ? "The handwriting service is not configured correctly."
      : "The handwriting service could not return a valid assessment.";
    return json({ message }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
