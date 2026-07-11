import { createHmac } from "node:crypto";
import { isSimplifiedCandidate } from "./simplified";
import type { CharacterPrediction, Stroke } from "./types";

export const MYSCRIPT_ENDPOINT = "https://cloud.myscript.com/api/v4.0/iink/recognize";
export const MYSCRIPT_LANGUAGE = "zh_CN";
const CANVAS_SIZE = 180;
const INK_SIZE = 150;
const PIXEL_TO_MM = 25.4 / 96;

export interface MyScriptStroke {
  id: string;
  pointerType: "PEN";
  x: number[];
  y: number[];
  t: number[];
  p: number[];
}

export interface MyScriptPayload {
  scaleX: number;
  scaleY: number;
  contentType: "Text";
  configuration: {
    lang: typeof MYSCRIPT_LANGUAGE;
    text: {
      mimeTypes: ["application/vnd.myscript.jiix"];
      margin: { top: number; left: number; right: number; bottom: number };
      guides: { enable: false };
      eraser: { "erase-precisely": false };
    };
    export: {
      jiix: {
        "bounding-box": false;
        strokes: false;
        ids: false;
        "full-stroke-ids": false;
        text: { chars: true; words: true; lines: false };
      };
    };
  };
  strokes: MyScriptStroke[];
}

interface JiixCandidateNode {
  label?: unknown;
  candidates?: unknown;
}

export interface MyScriptJiix {
  label?: unknown;
  chars?: unknown;
  words?: unknown;
}

function finitePoints(strokes: Stroke[]) {
  return strokes.flatMap((stroke) => stroke.points).filter((point) =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.timestamp)
  );
}

export function buildMyScriptPayload(strokes: Stroke[]): MyScriptPayload {
  const points = finitePoints(strokes);
  if (!points.length) throw new Error("No usable handwriting points were supplied.");

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const drawnWidth = ((maxX - minX) / span) * INK_SIZE;
  const drawnHeight = ((maxY - minY) / span) * INK_SIZE;
  const offsetX = (CANVAS_SIZE - drawnWidth) / 2;
  const offsetY = (CANVAS_SIZE - drawnHeight) / 2;
  const firstTimestamp = Math.min(...points.map((point) => point.timestamp));

  const formatted = strokes.flatMap((stroke, strokeIndex) => {
    const usable = stroke.points.filter((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.timestamp)
    );
    if (!usable.length) return [];
    let previousTime = 0;
    return [{
      id: `stroke-${strokeIndex}`,
      pointerType: "PEN" as const,
      x: usable.map((point) => offsetX + ((point.x - minX) / span) * INK_SIZE),
      y: usable.map((point) => offsetY + ((point.y - minY) / span) * INK_SIZE),
      t: usable.map((point) => {
        const time = Math.round(Math.max(0, point.timestamp - firstTimestamp));
        previousTime = Math.max(previousTime, time);
        return previousTime;
      }),
      // MyScript stores pressure but does not currently use it for recognition.
      // Keep a valid value for every point because all stroke arrays must align.
      p: usable.map((point) => Math.max(0.001, Math.min(0.999, point.pressure ?? 0.5))),
    }];
  });

  return {
    scaleX: PIXEL_TO_MM,
    scaleY: PIXEL_TO_MM,
    contentType: "Text",
    configuration: {
      lang: MYSCRIPT_LANGUAGE,
      text: {
        mimeTypes: ["application/vnd.myscript.jiix"],
        margin: { top: 0, left: 0, right: 0, bottom: 0 },
        guides: { enable: false },
        eraser: { "erase-precisely": false },
      },
      export: {
        jiix: {
          "bounding-box": false,
          strokes: false,
          ids: false,
          "full-stroke-ids": false,
          text: { chars: true, words: true, lines: false },
        },
      },
    },
    strokes: formatted,
  };
}

export function computeMyScriptHmac(body: string, applicationKey: string, hmacKey: string) {
  return createHmac("sha512", applicationKey + hmacKey).update(body).digest("hex");
}

function candidateStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function nodes(value: unknown): JiixCandidateNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JiixCandidateNode => Boolean(item) && typeof item === "object");
}

export function parseMyScriptCandidates(jiix: MyScriptJiix, maximumResults = 15): CharacterPrediction[] {
  const ordered: string[] = [];
  const add = (candidate: unknown) => {
    if (typeof candidate !== "string") return;
    for (const character of Array.from(candidate.trim())) {
      if (Array.from(candidate.trim()).length !== 1 || !isSimplifiedCandidate(character) || ordered.includes(character)) continue;
      ordered.push(character);
    }
  };

  // Each request contains exactly one segmented character. If MyScript emits
  // more than one char node, later nodes are positions, not alternatives.
  for (const item of nodes(jiix.chars).slice(0, 1)) {
    add(item.label);
    candidateStrings(item.candidates).forEach(add);
  }
  for (const item of nodes(jiix.words)) {
    add(item.label);
    candidateStrings(item.candidates).forEach(add);
  }
  add(jiix.label);

  const limit = Math.max(1, Math.min(40, Math.floor(maximumResults)));
  return ordered.slice(0, limit).map((character, index) => ({ character, rank: index + 1 }));
}
