import { describe, expect, it } from "vitest";
import {
  applyVisibleShapeTransform,
  normalizeVisibleShape,
  visibleShapeBounds,
} from "./visible-shape-normalization";

describe("visible-shape normalization", () => {
  it("removes whole-character translation and size while preserving aspect ratio", () => {
    const original = [[{ x: 100, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 400 }]];
    const smallAndShifted = [[{ x: 710, y: 120 }, { x: 910, y: 120 }, { x: 910, y: 220 }]];

    const first = normalizeVisibleShape(original)!;
    const second = normalizeVisibleShape(smallAndShifted)!;

    second.paths[0].forEach((point, index) => {
      expect(point.x).toBeCloseTo(first.paths[0][index].x, 10);
      expect(point.y).toBeCloseTo(first.paths[0][index].y, 10);
    });
    const normalizedBounds = visibleShapeBounds(first.paths)!;
    expect(normalizedBounds.width).toBeCloseTo(820, 10);
    expect(normalizedBounds.height).toBeCloseTo(410, 10);
    expect(normalizedBounds.centerX).toBeCloseTo(512, 10);
    expect(normalizedBounds.centerY).toBeCloseTo(512, 10);
  });

  it("uses one uniform scale and therefore retains malformed proportions", () => {
    const square = normalizeVisibleShape([[{ x: 0, y: 0 }, { x: 100, y: 100 }]])!;
    const narrow = normalizeVisibleShape([[{ x: 0, y: 0 }, { x: 50, y: 100 }]])!;

    expect(visibleShapeBounds(square.paths)?.width).toBe(820);
    expect(visibleShapeBounds(narrow.paths)?.width).toBe(410);
    expect(visibleShapeBounds(narrow.paths)?.height).toBe(820);
  });

  it("can apply the same character transform to component subsets", () => {
    const paths = [
      [{ x: 100, y: 100 }, { x: 500, y: 100 }],
      [{ x: 500, y: 100 }, { x: 500, y: 700 }],
    ];
    const normalized = normalizeVisibleShape(paths)!;
    expect(applyVisibleShapeTransform([paths[1]], normalized.transform)[0]).toEqual(normalized.paths[1]);
  });

  it("fails closed for empty, degenerate, invalid, and invalid-span input", () => {
    expect(normalizeVisibleShape([])).toBeNull();
    expect(normalizeVisibleShape([[{ x: 1, y: 1 }]])).toBeNull();
    expect(normalizeVisibleShape([[{ x: Number.NaN, y: 1 }, { x: 2, y: 2 }]])).toBeNull();
    expect(normalizeVisibleShape([[{ x: 0, y: 0 }, { x: 1, y: 1 }]], 2_000)).toBeNull();
  });
});
