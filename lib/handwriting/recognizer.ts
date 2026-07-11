import { convertStrokesForRecognizer } from "./coordinate-adapter";
import type { CharacterPrediction, HandwritingRecognizer, Stroke } from "./types";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type WorkerReply =
  | { type: "ready" }
  | { type: "result"; id: number; matches: { hanzi: string; score?: number }[] }
  | { type: "error"; id?: number; message: string };

let sharedWorker: Worker | null = null;
let sharedReady: Promise<void> | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (value: CharacterPrediction[]) => void; reject: (reason: Error) => void; maxResults: number }>();

function getWorker() {
  if (!sharedWorker) {
    sharedWorker = new Worker(`${BASE_PATH}/recognizer-worker.js`);
    sharedWorker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const message = event.data;
      if (message.type === "result") {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        request.resolve(message.matches.slice(0, request.maxResults).map((match, index) => ({ character: match.hanzi, score: match.score, rank: index + 1 })));
      } else if (message.type === "error" && message.id != null) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        request?.reject(new Error(message.message));
      }
    };
  }
  return sharedWorker;
}

export class HanziLookupRecognizer implements HandwritingRecognizer {
  async initialise() {
    if (!sharedReady) {
      sharedReady = new Promise<void>((resolve, reject) => {
        const worker = getWorker();
        const onMessage = (event: MessageEvent<WorkerReply>) => {
          if (event.data.type === "ready") {
            worker.removeEventListener("message", onMessage);
            resolve();
          } else if (event.data.type === "error" && event.data.id == null) {
            worker.removeEventListener("message", onMessage);
            sharedReady = null;
            reject(new Error(event.data.message));
          }
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ type: "init", wasmUrl: `${BASE_PATH}/hanzi_lookup_bg.wasm` });
      });
    }
    return sharedReady;
  }

  async recognise(strokes: Stroke[], maxResults = 10): Promise<CharacterPrediction[]> {
    await this.initialise();
    const input = convertStrokesForRecognizer(strokes);
    if (!input.length) return [];
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, maxResults });
      getWorker().postMessage({ type: "lookup", id, strokes: input, limit: Math.max(40, maxResults * 4) });
    });
  }
}
