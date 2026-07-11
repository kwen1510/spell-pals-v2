import type { CharacterPrediction, HandwritingRecognizer, Stroke } from "./types";

type StatusResponse = { available?: boolean; message?: string };
type RecognitionResponse = { candidates?: CharacterPrediction[]; message?: string };

export class MyScriptRecognizer implements HandwritingRecognizer {
  private ready: Promise<void> | null = null;
  private activeRequests = new Set<AbortController>();

  initialise(): Promise<void> {
    if (!this.ready) {
      this.ready = fetch("/api/myscript", { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json().catch(() => ({})) as StatusResponse;
          if (!response.ok || !body.available) throw new Error(body.message || "MyScript is not configured.");
        })
        .catch((error) => {
          this.ready = null;
          throw error;
        });
    }
    return this.ready;
  }

  async recognise(strokes: Stroke[], maxResults = 15): Promise<CharacterPrediction[]> {
    await this.initialise();
    if (!strokes.length) return [];
    const controller = new AbortController();
    this.activeRequests.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/myscript", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strokes, maxResults }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as RecognitionResponse;
      if (!response.ok) throw new Error(body.message || "MyScript recognition failed.");
      return Array.isArray(body.candidates) ? body.candidates.slice(0, maxResults) : [];
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("MyScript recognition timed out. Please try again.");
      throw error;
    } finally {
      window.clearTimeout(timeout);
      this.activeRequests.delete(controller);
    }
  }

  dispose(): void {
    for (const controller of this.activeRequests) controller.abort();
    this.activeRequests.clear();
  }
}
