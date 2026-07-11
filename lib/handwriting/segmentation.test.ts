import { describe, expect, it } from "vitest";
import { segmentByBoxes, segmentByWhitespace } from "./segmentation";
import type { Stroke } from "./types";

function line(id: string, x1: number, x2 = x1): Stroke {
  return { id, width: 5, points: [{ x: x1, y: 20, timestamp: 0 }, { x: x2, y: 180, timestamp: 1 }] };
}

describe("segmentation", () => {
  it("assigns strokes to two writing boxes", () => {
    const result = segmentByBoxes([line("left", 50), line("right", 450)], 2, 600);
    expect(result.groups.map((group) => group.map((item) => item.id))).toEqual([["left"], ["right"]]);
    expect(result.separators).toEqual([300]);
  });

  it("assigns strokes to three writing boxes", () => {
    const result = segmentByBoxes([line("a", 80), line("b", 330), line("c", 820)], 3, 900);
    expect(result.groups.map((group) => group.length)).toEqual([1, 1, 1]);
  });

  it("finds a clear vertical gap for two characters", () => {
    const result = segmentByWhitespace([line("a", 50, 150), line("b", 420, 550)], 2, 600);
    expect(result.groups[0][0].id).toBe("a");
    expect(result.groups[1][0].id).toBe("b");
    expect(result.weak).toBe(false);
  });

  it("preserves all strokes for uneven three-character input", () => {
    const strokes = [line("a", 20, 100), line("b", 240, 400), line("c", 700, 880)];
    const result = segmentByWhitespace(strokes, 3, 900);
    expect(result.groups.flat()).toHaveLength(3);
    expect(new Set(result.groups.flat().map((item) => item.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("reports a weak split when a region is empty", () => {
    const result = segmentByWhitespace([line("only", 30, 80)], 2, 600);
    expect(result.weak).toBe(true);
  });

  it("assigns a crossing stroke to the region containing most points", () => {
    const crossing: Stroke = { id: "cross", width: 5, points: [
      { x: 100, y: 10, timestamp: 0 }, { x: 120, y: 30, timestamp: 1 },
      { x: 140, y: 50, timestamp: 2 }, { x: 400, y: 70, timestamp: 3 },
    ] };
    const result = segmentByBoxes([crossing], 2, 600);
    expect(result.groups[0][0].id).toBe("cross");
  });
});
