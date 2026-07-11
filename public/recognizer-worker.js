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
  if (message.type === "lookup") {
    try {
      if (!ready) throw new Error("The handwriting recogniser is not ready.");
      const matches = JSON.parse(wasm_bindgen.lookup(message.strokes, message.limit));
      self.postMessage({ type: "result", id: message.id, matches });
    } catch (error) {
      self.postMessage({ type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
};
