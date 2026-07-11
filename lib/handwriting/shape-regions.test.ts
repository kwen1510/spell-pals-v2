import { describe, expect, it } from "vitest";
import { characterShapeRegions } from "./shape-regions";

describe("shape validation regions", () => {
  it("uses one exact square per box", () => {
    expect(characterShapeRegions(2, "boxes", 600, 300, [300])).toEqual([
      { x: 0, y: 0, width: 300, height: 300 },
      { x: 300, y: 0, width: 300, height: 300 },
    ]);
  });

  it("centres square frames on uneven free-canvas intervals without stretching", () => {
    expect(characterShapeRegions(2, "free", 600, 300, [250])).toEqual([
      { x: -25, y: 0, width: 300, height: 300 },
      { x: 275, y: 0, width: 300, height: 300 },
    ]);
  });

  it("falls back to balanced free-canvas intervals when separators are incomplete", () => {
    expect(characterShapeRegions(3, "free", 900, 300, [])).toEqual([
      { x: 0, y: 0, width: 300, height: 300 },
      { x: 300, y: 0, width: 300, height: 300 },
      { x: 600, y: 0, width: 300, height: 300 },
    ]);
  });
});
