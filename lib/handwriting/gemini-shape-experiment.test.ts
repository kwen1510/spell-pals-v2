import { describe, expect, it } from "vitest";
import { getCharacterTemplate } from "./character-template";
import {
  buildGeminiShapePrompt,
  normalizeShapePaths,
  renderShapePng,
} from "./gemini-shape-experiment";

describe("Gemini shape experiment grounding", () => {
  it("uniformly normalizes without stretching proportions", () => {
    const normalized = normalizeShapePaths([[{ x: 10, y: 20 }, { x: 110, y: 70 }]]);
    expect(normalized[0][0].x).toBeCloseTo(0.11);
    expect(normalized[0][1].x).toBeCloseTo(0.89);
    expect(normalized[0][1].y - normalized[0][0].y).toBeCloseTo(0.39);
  });

  it("renders a supported PNG rather than sending the guide or canvas", () => {
    const png = renderShapePng([[{ x: 0, y: 0 }, { x: 1, y: 1 }]], 96);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("grounds the prompt with IDS components and pen-lift-independent rules", () => {
    const template = getCharacterTemplate("听")!;
    const prompt = buildGeminiShapePrompt(template, template.modelStrokes.map((stroke) => stroke.median));
    expect(prompt).toContain("⿰口斤");
    expect(prompt).toContain("one continuous loop");
    expect(prompt).toContain("all four boundaries");
    expect(prompt).toContain("positiveFeedback");
    expect(prompt).toContain('"label": "口"');
    expect(prompt).toContain('"label": "斤"');
  });
});
