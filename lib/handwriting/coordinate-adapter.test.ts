import { describe, expect, it } from "vitest";
import { convertStrokesForRecognizer, simplifyRecognizerPoints } from "./coordinate-adapter";
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

  it("simplifies dense noisy stylus samples without losing corners", () => {
    const dense = Array.from({ length: 401 }, (_, index) => {
      const x = index <= 200 ? index / 2 : 100;
      const y = index <= 200 ? Math.sin(index) * 0.2 : (index - 200) / 2;
      return [x, y];
    });
    const simplified = simplifyRecognizerPoints(dense, 1);
    expect(simplified.length).toBeLessThan(12);
    expect(simplified[0]).toEqual(dense[0]);
    expect(simplified.at(-1)).toEqual(dense.at(-1));
    expect(simplified.some(([x, y]) => x > 99 && y < 2)).toBe(true);
  });

  it("caps pathological coalesced input for recognition only", () => {
    const points = Array.from({ length: 2000 }, (_, index) => [index / 10, Math.sin(index / 2) * 8] as [number, number]);
    const output = convertStrokesForRecognizer([stroke("dense", points)]);
    expect(output[0].length).toBeLessThanOrEqual(96);
  });
});
