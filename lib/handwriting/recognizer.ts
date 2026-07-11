import {
  createRecognitionVariants,
  fuseRecognitionResults,
  RAW_LOOKUP_LIMIT,
  type VariantRecognitionResult,
} from "./recognition-ensemble";
import type { CharacterPrediction, HandwritingRecognizer, Stroke } from "./types";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const WORKER_VERSION = "ensemble-v1";
const LOOKUP_TIMEOUT_MS = 15_000;

type WorkerReply =
  | { type: "ready" }
  | { type: "batchResult"; id: number; results: VariantRecognitionResult[] }
  | { type: "error"; id?: number; message: string };

let sharedWorker: Worker | null = null;
let sharedReady: Promise<void> | null = null;
let nextId = 0;
const pending = new Map<number, {
  resolve: (value: VariantRecognitionResult[]) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

function getWorker() {
  if (!sharedWorker) {
    sharedWorker = new Worker(`${BASE_PATH}/recognizer-worker.js?v=${WORKER_VERSION}`);
    sharedWorker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const message = event.data;
      if (message.type === "batchResult") {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timeout);
        request.resolve(message.results);
      } else if (message.type === "error" && message.id != null) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (request) clearTimeout(request.timeout);
        request?.reject(new Error(message.message));
      }
    };
    sharedWorker.onerror = (event) => {
      const error = new Error(event.message || "The handwriting recogniser worker failed.");
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      pending.clear();
      sharedReady = null;
      sharedWorker?.terminate();
      sharedWorker = null;
    };
  }
  return sharedWorker;
}

export class HanziLookupRecognizer implements HandwritingRecognizer {
  async initialise() {
    if (!sharedReady) {
      sharedReady = new Promise<void>((resolve, reject) => {
        const worker = getWorker();
        const cleanup = () => {
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
        };
        const onMessage = (event: MessageEvent<WorkerReply>) => {
          if (event.data.type === "ready") {
            cleanup();
            resolve();
          } else if (event.data.type === "error" && event.data.id == null) {
            cleanup();
            sharedReady = null;
            reject(new Error(event.data.message));
          }
        };
        const onError = (event: ErrorEvent) => {
          cleanup();
          sharedReady = null;
          reject(new Error(event.message || "The handwriting recogniser worker failed to load."));
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage({ type: "init", wasmUrl: `${BASE_PATH}/hanzi_lookup_bg.wasm` });
      });
    }
    return sharedReady;
  }

  async recognise(strokes: Stroke[], maxResults = 15): Promise<CharacterPrediction[]> {
    await this.initialise();
    const variants = createRecognitionVariants(strokes);
    if (!variants.length) return [];
    const id = ++nextId;
    const results = await new Promise<VariantRecognitionResult[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The handwriting recogniser took too long to respond. Please try again."));
      }, LOOKUP_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timeout });
      getWorker().postMessage({
        type: "lookupBatch",
        id,
        variants: variants.map((variant) => ({ variantId: variant.id, strokes: variant.input })),
        limit: RAW_LOOKUP_LIMIT,
      });
    });
    return fuseRecognitionResults(variants, results, maxResults);
  }
}
