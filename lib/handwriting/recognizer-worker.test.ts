import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface WorkerHarness {
  posted: unknown[];
  send(data: unknown): Promise<void>;
}

function loadWorker(): WorkerHarness {
  const posted: unknown[] = [];
  const lookup = (strokes: number[][][], limit: number) => JSON.stringify([
    { hanzi: strokes.length === 1 ? "一" : "二", score: limit },
  ]);
  const initialise = Object.assign(async () => undefined, { lookup });
  const context: Record<string, unknown> = {
    URL,
    location: { href: "https://example.test/recognizer-worker.js" },
    postMessage: (message: unknown) => posted.push(message),
    importScripts: () => { context.wasm_bindgen = initialise; },
  };
  context.self = context;
  vm.runInNewContext(fs.readFileSync(`${process.cwd()}/public/recognizer-worker.js`, "utf8"), context);
  return {
    posted,
    send: (data) => (context.onmessage as (event: { data: unknown }) => Promise<void>)({ data }),
  };
}

describe("recognizer worker protocol", () => {
  it("initialises once and processes a bounded lookup batch", async () => {
    const worker = loadWorker();
    await worker.send({ type: "init", wasmUrl: "/hanzi_lookup_bg.wasm" });
    await worker.send({ type: "init", wasmUrl: "/hanzi_lookup_bg.wasm" });
    await worker.send({
      type: "lookupBatch",
      id: 9,
      limit: 500,
      variants: [
        { variantId: "baseline-2.25", strokes: [[[0, 0], [1, 1]]] },
        { variantId: "pause", strokes: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
      ],
    });
    expect(worker.posted.slice(0, 2)).toEqual([{ type: "ready" }, { type: "ready" }]);
    expect(worker.posted[2]).toEqual({
      type: "batchResult",
      id: 9,
      results: [
        { variantId: "baseline-2.25", matches: [{ hanzi: "一", score: 100 }] },
        { variantId: "pause", matches: [{ hanzi: "二", score: 100 }] },
      ],
    });
  });

  it("reports lookup attempts made before initialisation", async () => {
    const worker = loadWorker();
    await worker.send({ type: "lookupBatch", id: 3, variants: [], limit: 40 });
    expect(worker.posted[0]).toEqual({
      type: "error",
      id: 3,
      message: "The handwriting recogniser is not ready.",
    });
  });
});
