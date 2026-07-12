import { describe, expect, it } from "vitest";
import { SUPPORTED_SHAPE_CHARACTERS } from "./character-shape-references";
import { getCharacterTemplate } from "./character-template";
import { assessRoughShape } from "./rough-shape-matcher";

describe("rough visible-piece matching", () => {
  it("accepts all reviewed model shapes", () => {
    for (const character of SUPPORTED_SHAPE_CHARACTERS) {
      const template = getCharacterTemplate(character)!;
      const assessment = assessRoughShape(template, template.modelStrokes.map((stroke) => stroke.median));
      expect(assessment.passed, `${character}: ${JSON.stringify(assessment)}`).toBe(true);
      expect(assessment.missingCriticalPieceIds).toEqual([]);
      expect(assessment.extraStudentPieceIds).toEqual([]);
    }
  });

  it("accepts a continuous visible box even though its pen-lift count differs", () => {
    const template = getCharacterTemplate("听")!;
    const mouth = template.components.find((component) => component.label === "口")!;
    const box = [
      { x: mouth.expectedRegion.xMin, y: mouth.expectedRegion.yMin },
      { x: mouth.expectedRegion.xMax, y: mouth.expectedRegion.yMin },
      { x: mouth.expectedRegion.xMax, y: mouth.expectedRegion.yMax },
      { x: mouth.expectedRegion.xMin, y: mouth.expectedRegion.yMax },
      { x: mouth.expectedRegion.xMin, y: mouth.expectedRegion.yMin },
    ];
    const rightSide = template.modelStrokes
      .filter((stroke) => stroke.componentId !== mouth.id)
      .map((stroke) => stroke.median);
    const assessment = assessRoughShape(template, [box, ...rightSide]);

    expect(assessment.passed, JSON.stringify(assessment)).toBe(true);
    expect(assessment.components.find((component) => component.id === mouth.id)?.passed).toBe(true);
  });

  it("merges a harmless pen lift through one visible line", () => {
    const template = getCharacterTemplate("飞")!;
    const longest = template.modelStrokes
      .map((stroke, index) => ({ stroke, index }))
      .sort((left, right) => right.stroke.length - left.stroke.length)[0];
    const splitIndex = Math.max(2, Math.floor(longest.stroke.median.length / 2));
    const pieces = [
      longest.stroke.median.slice(0, splitIndex),
      longest.stroke.median.slice(splitIndex - 1),
    ];
    const otherPaths = template.modelStrokes
      .filter((_, index) => index !== longest.index)
      .map((stroke) => stroke.median);
    const assessment = assessRoughShape(template, [...pieces, ...otherPaths]);

    expect(assessment.passed, JSON.stringify(assessment)).toBe(true);
  });

  it("fails when a substantial visible model piece is removed", () => {
    const template = getCharacterTemplate("写")!;
    const longestIndex = template.modelStrokes
      .map((stroke) => stroke.length)
      .reduce((best, length, index, lengths) => length > lengths[best] ? index : best, 0);
    const paths = template.modelStrokes.filter((_, index) => index !== longestIndex).map((stroke) => stroke.median);
    const assessment = assessRoughShape(template, paths);

    expect(assessment.passed).toBe(false);
    expect(assessment.missingCriticalPieceIds.length).toBeGreaterThan(0);
  });

  it("fails a major unrelated extra line but ignores a small retrace", () => {
    const template = getCharacterTemplate("飞")!;
    const canonical = template.modelStrokes.map((stroke) => stroke.median);
    const extra = [{ x: 0.08, y: 0.92 }, { x: 0.9, y: 0.92 }];
    const wrong = assessRoughShape(template, [...canonical, extra]);
    expect(wrong.passed, JSON.stringify(wrong)).toBe(false);
    expect(wrong.majorExtraInk).toBe(true);

    const retrace = template.modelStrokes[0].median.map((point) => ({ x: point.x + 0.005, y: point.y + 0.004 }));
    const retraced = assessRoughShape(template, [...canonical, retrace]);
    expect(retraced.passed, JSON.stringify(retraced)).toBe(true);
    expect(retraced.ignoredRetracePieceIds.length).toBeGreaterThan(0);
  });
});
