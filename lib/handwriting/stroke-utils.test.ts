import { describe, expect, it } from "vitest";
import { addPoint, cloneStrokes, undoStroke } from "./stroke-utils";
import type { Stroke } from "./types";

const base: Stroke = { id: "s", width: 5, points: [{ x: 1, y: 1, timestamp: 0 }] };

describe("stroke utilities", () => {
  it("adds a sufficiently distinct point", () => {
    expect(addPoint(base, { x: 4, y: 4, timestamp: 1 }).points).toHaveLength(2);
  });

  it("ignores an adjacent duplicate point", () => {
    expect(addPoint(base, { x: 1.1, y: 1.1, timestamp: 1 }).points).toHaveLength(1);
  });

  it("undoes the latest completed stroke", () => {
    expect(undoStroke([base, { ...base, id: "s2" }]).map((item) => item.id)).toEqual(["s"]);
  });

  it("deep-clones stroke points", () => {
    const copy = cloneStrokes([base]);
    copy[0].points[0].x = 99;
    expect(base.points[0].x).toBe(1);
  });
});
