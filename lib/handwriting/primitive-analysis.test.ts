import { describe, expect, it } from "vitest";
import { extractVisualPrimitives } from "./primitive-analysis";

describe("visual primitive extraction", () => {
  it("classifies long axes and tiny dots", () => {
    const primitives = extractVisualPrimitives([
      { id: "h", points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.21 }] },
      { id: "v", points: [{ x: 0.4, y: 0.1 }, { x: 0.41, y: 0.8 }] },
      { id: "d", points: [{ x: 0.7, y: 0.7 }, { x: 0.72, y: 0.73 }] },
    ]);
    expect(primitives[0].typeProbabilities.horizontal).toBeGreaterThan(0.8);
    expect(primitives[1].typeProbabilities.vertical).toBeGreaterThan(0.8);
    expect(primitives[2].typeProbabilities.dot).toBeGreaterThan(0.8);
  });

  it("splits a square-like continuous movement at strong corners", () => {
    const primitives = extractVisualPrimitives([{
      id: "box",
      points: [
        { x: 0.2, y: 0.2 }, { x: 0.7, y: 0.2 },
        { x: 0.7, y: 0.7 }, { x: 0.2, y: 0.7 },
      ],
    }]);
    expect(primitives).toHaveLength(3);
    expect(new Set(primitives.flatMap((primitive) => primitive.sourceMovementIds))).toEqual(new Set(["box"]));
  });

  it("finds rounded corners after simplifying dense pointer points", () => {
    const primitives = extractVisualPrimitives([{
      id: "rounded-box",
      points: [
        { x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.62, y: 0.2 },
        { x: 0.68, y: 0.23 }, { x: 0.7, y: 0.3 }, { x: 0.7, y: 0.55 },
        { x: 0.68, y: 0.66 }, { x: 0.6, y: 0.7 }, { x: 0.35, y: 0.7 },
      ],
    }]);
    expect(primitives.length).toBeGreaterThanOrEqual(3);
  });

  it("records intersections independently of pen lifts", () => {
    const primitives = extractVisualPrimitives([
      { id: "one", points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }] },
      { id: "two", points: [{ x: 0.9, y: 0.1 }, { x: 0.1, y: 0.9 }] },
    ]);
    expect(primitives[0].intersections).toEqual([primitives[1].id]);
    expect(primitives[1].intersections).toEqual([primitives[0].id]);
  });
});
