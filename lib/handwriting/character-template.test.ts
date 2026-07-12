import { describe, expect, it } from "vitest";
import { SUPPORTED_SHAPE_CHARACTERS } from "./character-shape-references";
import { clearCharacterTemplateCache, getCharacterTemplate } from "./character-template";

describe("reviewable character templates", () => {
  it("builds reviewed normalized templates for all production characters", () => {
    for (const character of SUPPORTED_SHAPE_CHARACTERS) {
      const template = getCharacterTemplate(character);
      expect(template).not.toBeNull();
      expect(template).toMatchObject({ character, source: "reviewed", confidence: 1, version: 1 });
      expect(template!.components.length).toBeGreaterThan(0);
      expect(template!.modelStrokes.length).toBeGreaterThan(0);
      for (const stroke of template!.modelStrokes) {
        expect(stroke.median.length).toBeGreaterThan(1);
        expect(stroke.bounds.xMin).toBeGreaterThanOrEqual(0);
        expect(stroke.bounds.yMin).toBeGreaterThanOrEqual(0);
        expect(stroke.bounds.xMax).toBeLessThanOrEqual(1);
        expect(stroke.bounds.yMax).toBeLessThanOrEqual(1);
        expect(stroke.primitiveTypes.length).toBeGreaterThan(0);
      }
    }
  });

  it("covers every model path with a component and caches the reviewed result", () => {
    const first = getCharacterTemplate("听")!;
    const covered = new Set(first.components.flatMap((component) => component.expectedStrokeIndexes));
    expect(first.modelStrokes.every((stroke) => covered.has(stroke.index))).toBe(true);
    expect(getCharacterTemplate("听")).toBe(first);

    clearCharacterTemplateCache();
    expect(getCharacterTemplate("听")).not.toBe(first);
  });

  it("fails closed for a character without a reviewed or generated template", () => {
    expect(getCharacterTemplate("水")).toBeNull();
  });
});
