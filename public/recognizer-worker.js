/* global wasm_bindgen */
let ready = false;

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "init") {
    if (ready) {
      self.postMessage({ type: "ready" });
      return;
    }
    try {
      self.importScripts(new URL("hanzi_lookup.js", self.location.href).href);
      await wasm_bindgen(message.wasmUrl);
      ready = true;
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (message.type === "lookupBatch") {
    try {
      if (!ready) throw new Error("The handwriting recogniser is not ready.");
      const limit = Math.max(1, Math.min(100, Math.floor(Number(message.limit) || 40)));
      const results = message.variants.map((variant) => ({
        variantId: variant.variantId,
        matches: JSON.parse(wasm_bindgen.lookup(variant.strokes, limit)),
      }));
      self.postMessage({ type: "batchResult", id: message.id, results });
    } catch (error) {
      self.postMessage({ type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
};
