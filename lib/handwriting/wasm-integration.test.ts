import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { convertStrokesForRecognizer } from "./coordinate-adapter";
import type { Stroke } from "./types";

const MEDIANS: Record<string, number[][][]> = {
  "写": [
    [[67,38],[70,46],[70,51],[57,80],[56,92]],
    [[78,47],[82,50],[92,49],[124,43],[175,37],[186,39],[190,42],[193,48],[172,69]],
    [[109,100],[113,97],[131,95],[155,88],[168,88]],
    [[97,66],[103,72],[105,76],[93,138],[107,138],[136,132],[173,128],[184,129],[192,136],[182,190],[177,207],[172,215],[165,220],[138,202]],
    [[42,180],[48,182],[60,182],[80,177],[138,168],[156,172]],
  ],
  "听": [
    [[23,82],[28,87],[32,92],[40,148]],
    [[36,82],[40,84],[69,77],[74,78],[79,84],[73,113],[66,118]],
    [[45,133],[48,129],[64,125],[77,124],[84,126]],
    [[196,42],[178,39],[152,55],[130,65],[128,65],[127,68]],
    [[105,60],[116,70],[116,74],[116,98],[114,123],[109,149],[101,170],[91,187],[76,204],[62,212]],
    [[124,109],[127,107],[151,102],[204,93],[214,93],[226,96]],
    [[160,106],[170,114],[170,241]],
  ],
};

function denseStrokes(character: string): Stroke[] {
  return MEDIANS[character].map((points, strokeIndex) => {
    const dense = points.flatMap((point, index) => {
      const next = points[index + 1];
      if (!next) return [point];
      return Array.from({ length: 16 }, (_, sample) => {
        const progress = sample / 16;
        const jitter = Math.sin((strokeIndex + 1) * (index + 1) * (sample + 1)) * 0.65;
        return [point[0] + (next[0] - point[0]) * progress + jitter, point[1] + (next[1] - point[1]) * progress - jitter];
      });
    });
    return { id: `${character}-${strokeIndex}`, width: 5, points: dense.map(([x, y], index) => ({ x, y, timestamp: index })) };
  });
}

async function loadLookup() {
  const context: Record<string, unknown> = {
    TextDecoder, TextEncoder, URL, Request, fetch, WebAssembly,
  };
  context.self = context;
  vm.runInNewContext(fs.readFileSync(`${process.cwd()}/public/hanzi_lookup.js`, "utf8"), context);
  const module = await WebAssembly.compile(fs.readFileSync(`${process.cwd()}/public/hanzi_lookup_bg.wasm`));
  await (context.wasm_bindgen as (module: WebAssembly.Module) => Promise<unknown>)(module);
  return (input: number[][][], limit: number) => JSON.parse((context.wasm_bindgen as { lookup: (input: number[][][], limit: number) => string }).lookup(input, limit)) as Array<{ hanzi: string }>;
}

describe("real hanzi_lookup WASM", () => {
  it("recognises dense noisy Apple Pencil-style 听 and 写 input after preprocessing", async () => {
    const lookup = await loadLookup();
    for (const character of ["听", "写"]) {
      const raw = denseStrokes(character);
      const converted = convertStrokesForRecognizer(raw);
      expect(converted.flat().length).toBeLessThan(raw.flatMap((stroke) => stroke.points).length / 3);
      const matches = lookup(converted, 15);
      expect(matches.findIndex((match) => match.hanzi === character)).toBeGreaterThanOrEqual(0);
      expect(matches.findIndex((match) => match.hanzi === character)).toBeLessThan(5);
    }
  });
});
