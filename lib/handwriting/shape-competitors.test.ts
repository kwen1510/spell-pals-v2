import { describe, expect, it } from "vitest";
import { SUPPORTED_SHAPE_CHARACTERS } from "./character-shape-references";
import { getShapeCompetitors } from "./shape-competitors";

describe("shape competitor references", () => {
  it.each([
    ["听", ["昕"]],
    ["师", ["帅"]],
    ["场", ["扬", "汤"]],
    ["机", ["杌"]],
  ] as const)("puts pinned known confusables first for %s", (expected, known) => {
    const competitors = getShapeCompetitors(expected);
    expect(competitors.slice(0, known.length).map((item) => item.character)).toEqual(known);
    expect(competitors.slice(0, known.length).every((item) => item.source === "known-confusable")).toBe(true);
  });

  it.each(SUPPORTED_SHAPE_CHARACTERS)("includes every other supported target for %s without duplicates", (expected) => {
    const competitors = getShapeCompetitors(expected);
    const characters = competitors.map((item) => item.character);
    expect(competitors.every((item) => item.label === item.character)).toBe(true);
    expect(characters).not.toContain(expected);
    expect(new Set(characters).size).toBe(characters.length);
    expect(SUPPORTED_SHAPE_CHARACTERS.filter((character) => character !== expected).every((character) =>
      characters.includes(character),
    )).toBe(true);
  });

  it("converts pinned y-up competitor coordinates to the app's y-down square", () => {
    const listening = getShapeCompetitors("听");
    const xin = listening.find((item) => item.character === "昕");
    expect(xin).toBeDefined();
    expect(xin?.paths[0][0]).toEqual({ x: 146, y: 211 });
    expect(xin?.paths).toHaveLength(8);
    expect(xin?.paths.flat().every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it("returns fresh paths so alignment transforms cannot mutate pinned data", () => {
    const first = getShapeCompetitors("场");
    const originalX = first[0].paths[0][0].x;
    first[0].paths[0][0].x = -999;

    const second = getShapeCompetitors("场");
    expect(second[0].paths[0][0].x).toBe(originalX);
  });

  it("returns no competitors for a character without a supported target reference", () => {
    expect(getShapeCompetitors("水")).toEqual([]);
    expect(getShapeCompetitors("")).toEqual([]);
  });
});
