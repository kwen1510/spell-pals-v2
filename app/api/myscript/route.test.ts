import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeMyScriptHmac } from "../../../lib/handwriting/myscript-api";
import { GET, POST } from "./route";

const SAMPLE_STROKES = [{
  id: "private-browser-id",
  width: 7,
  points: [
    { x: 10, y: 20, timestamp: 100.2, pressure: 0.4 },
    { x: 30, y: 45, timestamp: 140.8, pressure: 0.5 },
  ],
}];

function recognitionRequest(body: unknown, origin = "https://example.test") {
  return new NextRequest("https://example.test/api/myscript", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "X-Forwarded-For": `test-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(body),
  });
}

describe("MyScript API route", () => {
  beforeEach(() => {
    process.env.MYSCRIPT_APPLICATION_KEY = "test-application";
    process.env.MYSCRIPT_HMAC_KEY = "test-hmac";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MYSCRIPT_APPLICATION_KEY;
    delete process.env.MYSCRIPT_HMAC_KEY;
  });

  it("reports whether server-only credentials are configured", async () => {
    expect((await GET()).status).toBe(200);
    delete process.env.MYSCRIPT_HMAC_KEY;
    expect((await GET()).status).toBe(503);
  });

  it("signs and forwards a schema-conformant request without browser-private IDs", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      chars: [{ label: "听", candidates: ["斤", "昕"] }],
    }), { status: 200, headers: { "Content-Type": "application/vnd.myscript.jiix" } }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(recognitionRequest({ strokes: SAMPLE_STROKES, maxResults: 15 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      candidates: [
        { character: "听", rank: 1 },
        { character: "斤", rank: 2 },
        { character: "昕", rank: 3 },
      ],
    });

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const init = upstreamFetch.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    const body = String(init.body);
    expect(headers.Accept).toBe("application/vnd.myscript.jiix, application/json");
    expect(headers.hmac).toBe(computeMyScriptHmac(body, "test-application", "test-hmac"));
    const payload = JSON.parse(body) as { strokes: Array<{ id: string; pointerType: string; t: number[] }> };
    expect(payload.strokes[0]).toMatchObject({ id: "stroke-0", pointerType: "PEN", t: [0, 41] });
    expect(body).not.toContain("private-browser-id");
  });

  it("rejects cross-site requests before contacting MyScript", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const response = await POST(recognitionRequest({ strokes: SAMPLE_STROKES }, "https://attacker.test"));
    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects excessive coordinate and pressure values", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const response = await POST(recognitionRequest({
      strokes: [{ ...SAMPLE_STROKES[0], points: [{ x: 1e20, y: 2, timestamp: 3, pressure: 2 }] }],
    }));
    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("turns upstream quota errors into a safe retry message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "access.quota.exceeded" }), { status: 403 })));
    const response = await POST(recognitionRequest({ strokes: SAMPLE_STROKES }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "The MyScript test quota has been reached." });
  });
});
