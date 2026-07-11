import { describe, expect, it } from "vitest";
import { convertStrokesForRecognizer } from "./coordinate-adapter";
import type { Stroke } from "./types";

function stroke(id: string, points: [number, number][]): Stroke {
  return { id, width: 5, points: points.map(([x, y], index) => ({ x, y, timestamp: index })) };
}

describe("convertStrokesForRecognizer", () => {
  it("returns an empty value for empty input", () => {
    expect(convertStrokesForRecognizer([])).toEqual([]);
  });

  it("handles a single point without division by zero", () => {
    const output = convertStrokesForRecognizer([stroke("a", [[10, 10]])]);
    expect(output[0][0].every(Number.isFinite)).toBe(true);
    expect(output[0]).toHaveLength(2);
    expect(output[0][1]).not.toEqual(output[0][0]);
  });

  it("preserves stroke and point order", () => {
    const output = convertStrokesForRecognizer([
      stroke("first", [[0, 0], [5, 2]]),
      stroke("second", [[8, 9], [10, 12], [14, 15]]),
    ]);
    expect(output).toHaveLength(2);
    expect(output[0]).toHaveLength(2);
    expect(output[1]).toHaveLength(3);
    expect(output[0][0][0]).toBeLessThan(output[0][1][0]);
  });

  it("centres wide and tall inputs while preserving aspect ratio", () => {
    const wide = convertStrokesForRecognizer([stroke("wide", [[0, 0], [100, 10]])]);
    const tall = convertStrokesForRecognizer([stroke("tall", [[0, 0], [10, 100]])]);
    expect(wide[0][1][0] - wide[0][0][0]).toBeCloseTo(220);
    expect(tall[0][1][1] - tall[0][0][1]).toBeCloseTo(220);
  });

  it("normalises negative and out-of-range coordinates", () => {
    const output = convertStrokesForRecognizer([stroke("a", [[-400, 900], [1200, -80]])]);
    for (const point of output.flat()) {
      expect(point[0]).toBeGreaterThanOrEqual(0);
      expect(point[0]).toBeLessThanOrEqual(256);
      expect(point[1]).toBeGreaterThanOrEqual(0);
      expect(point[1]).toBeLessThanOrEqual(256);
    }
  });
});
