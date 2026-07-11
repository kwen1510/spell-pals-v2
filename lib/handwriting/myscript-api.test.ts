import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildMyScriptPayload, computeMyScriptHmac, parseMyScriptCandidates } from "./myscript-api";
import type { Stroke } from "./types";

function sampleStrokes(): Stroke[] {
  return [
    { id: "private-id", width: 7, points: [
      { x: 500, y: 100, timestamp: 1_000, pressure: 0 },
      { x: 600, y: 200, timestamp: 1_040.4, pressure: 1 },
    ] },
    { id: "second", width: 7, points: [
      { x: 520, y: 240, timestamp: 1_200, pressure: 0.4 },
      { x: 580, y: 250, timestamp: 1_240, pressure: 0.5 },
    ] },
  ];
}

describe("MyScript request adapter", () => {
  it("normalises isolated character ink while preserving order and relative timing", () => {
    const payload = buildMyScriptPayload(sampleStrokes());
    expect(payload.configuration.lang).toBe("zh_CN");
    expect(payload.configuration.export.jiix.text.chars).toBe(true);
    expect(payload.strokes).toHaveLength(2);
    expect(payload.strokes[0].id).toBe("stroke-0");
    expect(payload.strokes[0].pointerType).toBe("PEN");
    expect(payload.strokes[0].t).toEqual([0, 40]);
    expect(payload.strokes[1].t).toEqual([200, 240]);
    expect(payload.strokes[0].x[0]).toBeLessThan(payload.strokes[0].x[1]);
    expect(payload.strokes.flatMap((stroke) => stroke.p).every((pressure) => pressure > 0 && pressure < 1)).toBe(true);
  });

  it("signs the exact JSON body with the application and HMAC keys", () => {
    const body = JSON.stringify({ hello: "ink" });
    const expected = createHmac("sha512", "appsecret").update(body).digest("hex");
    expect(computeMyScriptHmac(body, "app", "secret")).toBe(expected);
  });

  it("prefers character alternatives, deduplicates, filters traditional-only and never returns question marks", () => {
    const candidates = parseMyScriptCandidates({
      label: "?",
      chars: [{ label: "听", candidates: ["听", "聽", "斤", "昕", "?"] }],
      words: [{ label: "听", candidates: ["听", "厅"] }],
    }, 15);
    expect(candidates.map((candidate) => candidate.character)).toEqual(["听", "斤", "昕", "厅"]);
    expect(candidates.map((candidate) => candidate.rank)).toEqual([1, 2, 3, 4]);
  });

  it("does not mix candidates from a second recognized character position", () => {
    const candidates = parseMyScriptCandidates({
      chars: [
        { label: "听", candidates: ["斤"] },
        { label: "写", candidates: ["字"] },
      ],
    }, 15);
    expect(candidates.map((candidate) => candidate.character)).toEqual(["听", "斤"]);
  });
});
